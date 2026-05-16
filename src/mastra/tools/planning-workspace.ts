import { createTool } from "@mastra/core/tools";
import { after } from "next/server";

import { indexTaskPlan } from "@/lib/rag/indexers/task-plan";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  boards,
  researchNotes,
  taskPlanRows,
  taskPlans,
  tasks,
} from "@/db/schema";
import {
  boardSnapshotToDigest,
  type RawBoardSnapshot,
} from "@/lib/boards/snapshot-digest";
import {
  isValidPriority,
  isValidStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/task-types";

import { toolResultSchema } from "./_envelope";

/**
 * Tools for the Planner agent. Same defense-in-depth as the
 * Researcher's tools: every tool reads `{teamId, projectId, planId}`
 * off `requestContext` (set by `/api/plan-chat/[planId]/route.ts`)
 * rather than trusting model input. The planner can edit ONLY rows
 * inside the active plan.
 */

export interface PlanningToolContext {
  teamId: string;
  projectId: string;
  /** Plan id the agent is operating on this turn. */
  planId: string;
}

function readPlanningContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): PlanningToolContext {
  const requestContext = ctx?.requestContext;
  if (!requestContext || typeof requestContext.get !== "function") {
    throw new Error(
      "planning tools require a `requestContext` on the Mastra invocation",
    );
  }
  const value = requestContext.get("planning") as PlanningToolContext | null;
  if (!value || !value.teamId || !value.projectId || !value.planId) {
    throw new Error(
      "planning tool context is missing teamId / projectId / planId",
    );
  }
  return value;
}

/* ─── tasks (existing) ─────────────────────────────── */

export const searchProjectTasksTool = createTool({
  id: "search_project_tasks",
  description:
    "Search existing tasks in the active project so you don't duplicate work that's already tracked. Returns tasks whose title or description match the query.",
  inputSchema: z.object({
    q: z.string().min(1).describe("Search query — title or description fragment."),
    limit: z.number().int().min(1).max(40).optional(),
  }),
  outputSchema: toolResultSchema(
    z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          priority: z.string(),
          assigneeId: z.string().nullable(),
        }),
      ),
    }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const like = `%${input.q}%`;
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        assigneeId: tasks.assigneeId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.teamId, ctx.teamId),
          eq(tasks.projectId, ctx.projectId),
          or(ilike(tasks.title, like), ilike(tasks.description, like)),
        ),
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(input.limit ?? 10);
    return { ok: true as const, data: { tasks: rows } };
  },
});

/* ─── boards (read-only digest, same shape as researcher) ─ */

export const listProjectBoardsTool = createTool({
  id: "list_project_boards",
  description:
    "List boards in the active project so you can pick one to read for context.",
  inputSchema: z.object({
    q: z.string().optional().describe("Optional name filter."),
    limit: z.number().int().min(1).max(40).optional(),
  }),
  outputSchema: toolResultSchema(
    z.object({
      boards: z.array(
        z.object({ id: z.string(), name: z.string() }),
      ),
    }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const where = and(
      eq(boards.teamId, ctx.teamId),
      eq(boards.projectId, ctx.projectId),
      input.q ? ilike(boards.name, `%${input.q}%`) : undefined,
    );
    const rows = await db
      .select({ id: boards.id, name: boards.name })
      .from(boards)
      .where(where)
      .orderBy(desc(boards.updatedAt))
      .limit(input.limit ?? 20);
    return { ok: true as const, data: { boards: rows } };
  },
});

export const readBoardTool = createTool({
  id: "read_board",
  description:
    "Read a board's compact digest (cards, mentions, structure) so you can derive concrete task rows from it. Capped at ~6 KB.",
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      boardId: z.string(),
      name: z.string(),
      bytes: z.number(),
      digest: z.string(),
    }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const row = await db.query.boards.findFirst({
      where: and(
        eq(boards.id, input.boardId),
        eq(boards.teamId, ctx.teamId),
        eq(boards.projectId, ctx.projectId),
      ),
      columns: { id: true, name: true, snapshot: true },
    });
    if (!row) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Board not found" },
      };
    }
    const digest = boardSnapshotToDigest({
      name: row.name,
      projectName: null,
      snapshot: (row.snapshot as RawBoardSnapshot | null) ?? null,
      updatedAt: new Date(),
    });
    return {
      ok: true as const,
      data: {
        boardId: row.id,
        name: row.name,
        bytes: digest.length,
        digest,
      },
    };
  },
});

/* ─── research notes (handoff bridge) ─────────────── */

export const readResearchNoteTool = createTool({
  id: "read_research_note",
  description:
    "Read a research note's body so you can derive a plan from it. Use this on the first turn after a handoff.",
  inputSchema: z.object({
    noteId: z
      .string()
      .optional()
      .describe(
        "Note id to read. If omitted, reads the source note linked to the active plan (when one was set at handoff).",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      noteId: z.string(),
      title: z.string(),
      body: z.string(),
      bytes: z.number(),
    }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    let targetId = input.noteId ?? null;
    if (!targetId) {
      // Resolve the plan's source note for the agent. This is the
      // common case after a handoff: the user clicked "Hand off to
      // planner", we pre-stamped the plan with `sourceNoteId`, and
      // the agent calls this tool with no args.
      const plan = await db.query.taskPlans.findFirst({
        where: and(
          eq(taskPlans.id, ctx.planId),
          eq(taskPlans.teamId, ctx.teamId),
        ),
        columns: { sourceNoteId: true },
      });
      targetId = plan?.sourceNoteId ?? null;
    }
    if (!targetId) {
      return {
        ok: false as const,
        error: {
          code: "not_found" as const,
          message:
            "No research note id was provided and this plan has no source note.",
        },
      };
    }
    const note = await db.query.researchNotes.findFirst({
      where: and(
        eq(researchNotes.id, targetId),
        eq(researchNotes.teamId, ctx.teamId),
        eq(researchNotes.projectId, ctx.projectId),
      ),
      columns: { id: true, title: true, body: true },
    });
    if (!note) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Research note not found" },
      };
    }
    return {
      ok: true as const,
      data: {
        noteId: note.id,
        title: note.title,
        body: note.body,
        bytes: note.body.length,
      },
    };
  },
});

/* ─── plan rows: the agent's main writing surface ─── */

// Mirror the canonical lists in `src/lib/tasks/task-types.ts`. Keep
// these in sync — the agent's enum advertised to the model has to
// match what `materialiseApprovedRows` will accept on insert.
const TASK_STATUS_VALUES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
const TASK_PRIORITY_VALUES = [
  "no_priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

const ROW_INPUT_SHAPE = {
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  assigneeId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Suggested assignee user id. Use null to clear. Omit to leave unassigned on insert.",
    ),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe("ISO 8601 date string. null clears, omit leaves unchanged."),
};

function parseDueDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const listPlanRowsTool = createTool({
  id: "list_plan_rows",
  description:
    "List the rows already in the active plan so you can avoid duplicating them and decide where to insert.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      planId: z.string(),
      title: z.string(),
      rows: z.array(
        z.object({
          id: z.string(),
          position: z.number(),
          title: z.string(),
          status: z.string(),
          priority: z.string(),
          approved: z.boolean(),
          executed: z.boolean(),
        }),
      ),
    }),
  ),
  execute: async (_input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const plan = await db.query.taskPlans.findFirst({
      where: and(
        eq(taskPlans.id, ctx.planId),
        eq(taskPlans.teamId, ctx.teamId),
      ),
      columns: { id: true, title: true },
      with: {
        rows: {
          orderBy: [asc(taskPlanRows.position)],
        },
      },
    });
    if (!plan) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Plan not found" },
      };
    }
    return {
      ok: true as const,
      data: {
        planId: plan.id,
        title: plan.title,
        rows: plan.rows.map((r) => ({
          id: r.id,
          position: r.position,
          title: r.title,
          status: r.status,
          priority: r.priority,
          approved: r.approvedAt !== null,
          executed: r.createdTaskId !== null,
        })),
      },
    };
  },
});

export const addPlanRowTool = createTool({
  id: "add_plan_row",
  description:
    "Append one task row to the active plan. Returns the new row id. Title is required; everything else has sensible defaults.",
  inputSchema: z.object({
    ...ROW_INPUT_SHAPE,
    position: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Insertion position (0-based). If omitted, appends at the end.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({ rowId: z.string(), position: z.number() }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);

    // Permission check: plan exists and belongs to active team/project.
    const plan = await db.query.taskPlans.findFirst({
      where: and(
        eq(taskPlans.id, ctx.planId),
        eq(taskPlans.teamId, ctx.teamId),
        eq(taskPlans.projectId, ctx.projectId),
      ),
      columns: { id: true },
    });
    if (!plan) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Plan not found" },
      };
    }

    // Append-by-default — read the current max position once.
    let position = input.position;
    if (typeof position !== "number") {
      const last = await db.query.taskPlanRows.findFirst({
        where: eq(taskPlanRows.planId, plan.id),
        orderBy: [desc(taskPlanRows.position)],
        columns: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }

    const status: TaskStatus =
      input.status && isValidStatus(input.status) ? input.status : "todo";
    const priority: TaskPriority =
      input.priority && isValidPriority(input.priority)
        ? input.priority
        : "medium";

    const [created] = await db
      .insert(taskPlanRows)
      .values({
        planId: plan.id,
        position,
        title: input.title,
        description: input.description ?? null,
        status,
        priority,
        assigneeId: input.assigneeId ?? null,
        dueDate: parseDueDate(input.dueDate),
      })
      .returning({ id: taskPlanRows.id, position: taskPlanRows.position });

    await db
      .update(taskPlans)
      .set({ updatedAt: new Date() })
      .where(eq(taskPlans.id, plan.id));

    // Plan's chunk shape changed (new row) — re-index after the
    // chat stream closes. `after()` works inside tool execute
    // because we're still inside the route handler's request
    // context.
    after(() => indexTaskPlan(plan.id));

    return {
      ok: true as const,
      data: { rowId: created.id, position: created.position },
    };
  },
});

export const updatePlanRowTool = createTool({
  id: "update_plan_row",
  description:
    "Edit one row in the active plan. Only the fields you pass change; omit to leave alone, set null to clear.",
  inputSchema: z.object({
    rowId: z.string(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    priority: z.enum(TASK_PRIORITY_VALUES).optional(),
    assigneeId: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  outputSchema: toolResultSchema(z.object({ rowId: z.string() })),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);

    // Make sure the row is inside the active plan.
    const row = await db.query.taskPlanRows.findFirst({
      where: eq(taskPlanRows.id, input.rowId),
      columns: { id: true, planId: true, createdTaskId: true },
      with: { plan: { columns: { teamId: true } } },
    });
    if (
      !row ||
      row.planId !== ctx.planId ||
      row.plan?.teamId !== ctx.teamId
    ) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Plan row not found" },
      };
    }
    if (row.createdTaskId) {
      return {
        ok: false as const,
        error: {
          code: "preconditions_failed" as const,
          message:
            "This row has already been materialised into a task — edit the task directly instead.",
        },
      };
    }

    const patch: Partial<typeof taskPlanRows.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof input.title === "string") patch.title = input.title;
    // Distinguish "field omitted" from "field set to null" — undefined
    // means leave alone, explicit null clears.
    if (input.description !== undefined)
      patch.description = input.description;
    if (input.status && isValidStatus(input.status))
      patch.status = input.status;
    if (input.priority && isValidPriority(input.priority))
      patch.priority = input.priority;
    if (input.assigneeId !== undefined)
      patch.assigneeId = input.assigneeId;
    if (input.dueDate !== undefined)
      patch.dueDate = parseDueDate(input.dueDate);
    if (typeof input.position === "number")
      patch.position = input.position;

    await db
      .update(taskPlanRows)
      .set(patch)
      .where(eq(taskPlanRows.id, input.rowId));
    await db
      .update(taskPlans)
      .set({ updatedAt: new Date() })
      .where(eq(taskPlans.id, ctx.planId));

    after(() => indexTaskPlan(ctx.planId));

    return { ok: true as const, data: { rowId: input.rowId } };
  },
});

export const removePlanRowTool = createTool({
  id: "remove_plan_row",
  description:
    "Delete a row from the active plan. Refuses to delete rows that already produced a real task.",
  inputSchema: z.object({ rowId: z.string() }),
  outputSchema: toolResultSchema(z.object({ rowId: z.string() })),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const row = await db.query.taskPlanRows.findFirst({
      where: eq(taskPlanRows.id, input.rowId),
      columns: { id: true, planId: true, createdTaskId: true },
      with: { plan: { columns: { teamId: true } } },
    });
    if (
      !row ||
      row.planId !== ctx.planId ||
      row.plan?.teamId !== ctx.teamId
    ) {
      return {
        ok: false as const,
        error: { code: "not_found" as const, message: "Plan row not found" },
      };
    }
    if (row.createdTaskId) {
      return {
        ok: false as const,
        error: {
          code: "preconditions_failed" as const,
          message:
            "Can't delete a row that already produced a task — delete the task itself if you don't want it.",
        },
      };
    }
    await db.delete(taskPlanRows).where(eq(taskPlanRows.id, input.rowId));
    await db
      .update(taskPlans)
      .set({ updatedAt: new Date() })
      .where(eq(taskPlans.id, ctx.planId));

    after(() => indexTaskPlan(ctx.planId));

    return { ok: true as const, data: { rowId: input.rowId } };
  },
});

export const setPlanTitleTool = createTool({
  id: "set_plan_title",
  description:
    "Set the active plan's title. Use after the rough shape of the plan emerges from the conversation.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
  }),
  outputSchema: toolResultSchema(z.object({ title: z.string() })),
  execute: async (input, ctxArg) => {
    const ctx = readPlanningContext(ctxArg);
    const trimmed = input.title.trim().slice(0, 200);
    if (!trimmed) {
      return {
        ok: false as const,
        error: {
          code: "invalid_input" as const,
          message: "Title can't be empty after trimming.",
        },
      };
    }
    await db
      .update(taskPlans)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(
        and(
          eq(taskPlans.id, ctx.planId),
          eq(taskPlans.teamId, ctx.teamId),
        ),
      );

    after(() => indexTaskPlan(ctx.planId));

    return { ok: true as const, data: { title: trimmed } };
  },
});

/**
 * Convenience bundle of every planning tool, ready to spread into an
 * Agent's `tools` map. Mirrors `researchWorkspaceTools`.
 */
export const planningWorkspaceTools = {
  list_project_boards: listProjectBoardsTool,
  read_board: readBoardTool,
  search_project_tasks: searchProjectTasksTool,
  read_research_note: readResearchNoteTool,
  list_plan_rows: listPlanRowsTool,
  add_plan_row: addPlanRowTool,
  update_plan_row: updatePlanRowTool,
  remove_plan_row: removePlanRowTool,
  set_plan_title: setPlanTitleTool,
};
