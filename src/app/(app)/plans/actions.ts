"use server";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/db";
import { dbTx } from "@/db/tx";
import {
  researchNotes,
  taskPlanRows,
  taskPlans,
  type TaskPlanStatus,
} from "@/db/schema";
import { tasks } from "@/db/schema/tasks";
import { logActivity } from "@/lib/activity";
import {
  indexTaskPlan,
  unindexTaskPlan,
} from "@/lib/rag/indexers/task-plan";
import { indexTask } from "@/lib/rag/indexers/task";
import { requireActiveProject, requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultTaskBoard } from "@/lib/projects";
import {
  isValidPriority,
  isValidStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/task-types";

/* ─── constraints ─────────────────────────────────── */

const MAX_TITLE = 200;
const MAX_ROW_DESCRIPTION = 4000; // tighter than tasks (16 KB) — rows are summaries
const MAX_ROWS_PER_PLAN = 50; // keeps plans focussed; agent can split if needed

const VALID_STATUSES: TaskPlanStatus[] = ["draft", "executed", "archived"];

/* ─── shapes ──────────────────────────────────────── */

export interface TaskPlanRowSummary {
  id: string;
  position: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: Date | null;
  approvedAt: Date | null;
  createdTaskId: string | null;
}

export interface TaskPlanSummary {
  id: string;
  title: string;
  status: TaskPlanStatus;
  authorId: string;
  authorName: string | null;
  rowCount: number;
  approvedRowCount: number;
  executedRowCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** Set when this plan was handed off from a research note. */
  sourceNoteId: string | null;
  sourceNoteTitle: string | null;
}

export interface TaskPlanDetail extends TaskPlanSummary {
  threadId: string;
  projectId: string;
  projectSlug: string;
  agentMeta: Record<string, unknown> | null;
  rows: TaskPlanRowSummary[];
  /** Body of the source research note, fetched eagerly so the detail page can
   *  render a "From: <note title>" preview without an extra round-trip. */
  sourceNote: { id: string; title: string; bodyPreview: string } | null;
}

/* ─── create ──────────────────────────────────────── */

export interface CreatePlanInput {
  projectSlug: string;
  title?: string;
  /** Optional handoff link — note id this plan derives from. Validated against
   *  the active team so we don't accept dangling fk values from URLs. */
  sourceNoteId?: string | null;
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<{ id: string }> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(input.projectSlug);

  let sourceNoteId: string | null = null;
  if (input.sourceNoteId) {
    const note = await db.query.researchNotes.findFirst({
      where: and(
        eq(researchNotes.id, input.sourceNoteId),
        eq(researchNotes.teamId, teamId),
        eq(researchNotes.projectId, projectId),
      ),
      columns: { id: true },
    });
    if (!note) throw new Error("Source research note not found");
    sourceNoteId = note.id;
  }

  const trimmedTitle = input.title?.trim().slice(0, MAX_TITLE) ?? "";

  const [created] = await db
    .insert(taskPlans)
    .values({
      teamId,
      projectId,
      authorId: session.user.id,
      sourceNoteId,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
    })
    .returning({ id: taskPlans.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "task_plan",
    subjectId: created.id,
    subjectName: trimmedTitle || "Untitled plan",
    metadata: sourceNoteId ? { sourceNoteId } : undefined,
  });

  // Brain indexing happens after the response. A brand-new empty
  // plan is unindexed by the indexer's self-heal branch (no rows
  // + default title) so this is a no-op at create time; matters
  // for symmetry with update.
  after(() => indexTaskPlan(created.id));

  revalidatePath(`/p/${projectSlug}/plans`);
  return { id: created.id };
}

/* ─── plan-level updates ─────────────────────────── */

export interface UpdatePlanInput {
  id: string;
  title?: string;
  status?: TaskPlanStatus;
}

export async function updatePlan(input: UpdatePlanInput): Promise<void> {
  const { session, teamId } = await requireActiveTeam();
  const plan = await db.query.taskPlans.findFirst({
    where: and(eq(taskPlans.id, input.id), eq(taskPlans.teamId, teamId)),
    columns: { id: true, title: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!plan) throw new Error("Plan not found");

  const patch: Partial<typeof taskPlans.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof input.title === "string") {
    patch.title =
      input.title.trim().slice(0, MAX_TITLE) || "Untitled plan";
  }
  if (input.status && VALID_STATUSES.includes(input.status)) {
    patch.status = input.status;
  }

  await db.update(taskPlans).set(patch).where(eq(taskPlans.id, input.id));

  // Re-index on title or status change. The indexer pulls archived
  // plans out of the brain via its self-heal branch.
  after(() => indexTaskPlan(input.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "task_plan",
    subjectId: input.id,
    subjectName: patch.title ?? plan.title,
  });

  if (plan.project?.slug) {
    revalidatePath(`/p/${plan.project.slug}/plans`);
    revalidatePath(`/p/${plan.project.slug}/plans/${input.id}`);
  }
}

export async function deletePlan(planId: string): Promise<void> {
  const { session, teamId } = await requireActiveTeam();
  const plan = await db.query.taskPlans.findFirst({
    where: and(eq(taskPlans.id, planId), eq(taskPlans.teamId, teamId)),
    columns: { id: true, title: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!plan) throw new Error("Plan not found");

  await db.delete(taskPlans).where(eq(taskPlans.id, planId));

  after(() => unindexTaskPlan(planId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "task_plan",
    subjectId: planId,
    subjectName: plan.title,
  });

  if (plan.project?.slug) {
    revalidatePath(`/p/${plan.project.slug}/plans`);
  }
}

/* ─── row CRUD ────────────────────────────────────── */

export interface UpsertPlanRowInput {
  /** When omitted → insert a new row. When set → update the row by id. */
  id?: string;
  planId: string;
  position?: number;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: Date | null;
}

/**
 * Create or update one row. Both paths share the same validation +
 * activity log so the agent and the human use the same code.
 *
 * Insert path:
 *   - Cap at `MAX_ROWS_PER_PLAN` to keep plans focused.
 *   - If `position` is omitted, append at the end (max+1).
 * Update path:
 *   - `id` must belong to a row inside the named plan, on the active
 *     team. We re-check both to keep this safe even when called from
 *     server-side tools where the agent provides the id.
 */
export async function upsertPlanRow(
  input: UpsertPlanRowInput,
): Promise<{ id: string }> {
  const { session, teamId } = await requireActiveTeam();

  const plan = await db.query.taskPlans.findFirst({
    where: and(
      eq(taskPlans.id, input.planId),
      eq(taskPlans.teamId, teamId),
    ),
    columns: { id: true, title: true, projectId: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!plan) throw new Error("Plan not found");

  const trimmedTitle = input.title.trim().slice(0, MAX_TITLE);
  if (!trimmedTitle) throw new Error("Row title is required");
  const description =
    input.description?.trim().slice(0, MAX_ROW_DESCRIPTION) || null;

  const status: TaskStatus =
    input.status && isValidStatus(input.status) ? input.status : "todo";
  const priority: TaskPriority =
    input.priority && isValidPriority(input.priority)
      ? input.priority
      : "medium";

  let resultId: string;
  if (input.id) {
    // Update path
    const existing = await db.query.taskPlanRows.findFirst({
      where: and(
        eq(taskPlanRows.id, input.id),
        eq(taskPlanRows.planId, plan.id),
      ),
      columns: { id: true },
    });
    if (!existing) throw new Error("Plan row not found");

    await db
      .update(taskPlanRows)
      .set({
        title: trimmedTitle,
        description,
        status,
        priority,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        ...(typeof input.position === "number"
          ? { position: input.position }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(taskPlanRows.id, input.id));
    resultId = input.id;
  } else {
    // Insert path
    const existingCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskPlanRows)
      .where(eq(taskPlanRows.planId, plan.id));
    if ((existingCount[0]?.count ?? 0) >= MAX_ROWS_PER_PLAN) {
      throw new Error(
        `A plan can hold up to ${MAX_ROWS_PER_PLAN} rows — split into a new plan.`,
      );
    }

    let position = input.position;
    if (typeof position !== "number") {
      const maxRow = await db
        .select({ max: sql<number | null>`max(${taskPlanRows.position})` })
        .from(taskPlanRows)
        .where(eq(taskPlanRows.planId, plan.id));
      position = (maxRow[0]?.max ?? -1) + 1;
    }

    const [created] = await db
      .insert(taskPlanRows)
      .values({
        planId: plan.id,
        position,
        title: trimmedTitle,
        description,
        status,
        priority,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
      })
      .returning({ id: taskPlanRows.id });
    resultId = created.id;
  }

  // Bump the plan's updatedAt so the index list re-sorts.
  await db
    .update(taskPlans)
    .set({ updatedAt: new Date() })
    .where(eq(taskPlans.id, plan.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: input.id ? "updated" : "added",
    subjectType: "task_plan",
    subjectId: plan.id,
    subjectName: plan.title,
    metadata: { rowId: resultId, rowTitle: trimmedTitle },
  });

  if (plan.project?.slug) {
    revalidatePath(`/p/${plan.project.slug}/plans/${plan.id}`);
  }
  // A row mutated → the whole plan re-indexes (rows are stored as
  // chunks of the plan artifact, not as separate kinds).
  after(() => indexTaskPlan(plan.id));
  return { id: resultId };
}

export async function deletePlanRow(rowId: string): Promise<void> {
  const { session, teamId } = await requireActiveTeam();

  const row = await db.query.taskPlanRows.findFirst({
    where: eq(taskPlanRows.id, rowId),
    columns: { id: true, title: true, planId: true },
    with: {
      plan: {
        columns: { id: true, teamId: true, title: true },
        with: { project: { columns: { slug: true } } },
      },
    },
  });
  if (!row || row.plan?.teamId !== teamId) {
    throw new Error("Plan row not found");
  }

  await db.delete(taskPlanRows).where(eq(taskPlanRows.id, rowId));
  await db
    .update(taskPlans)
    .set({ updatedAt: new Date() })
    .where(eq(taskPlans.id, row.planId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "removed",
    subjectType: "task_plan",
    subjectId: row.planId,
    subjectName: row.plan.title,
    metadata: { rowId, rowTitle: row.title },
  });

  if (row.plan.project?.slug) {
    revalidatePath(`/p/${row.plan.project.slug}/plans/${row.planId}`);
  }
  // Row deletion changes the plan's chunk shape — re-index.
  after(() => indexTaskPlan(row.planId));
}

/**
 * Approve or unapprove a row. Approval is just a timestamp on the
 * row — bulk-create later filters by `approvedAt is not null AND
 * createdTaskId is null`.
 */
export async function setPlanRowApproval(
  rowId: string,
  approved: boolean,
): Promise<void> {
  const { teamId } = await requireActiveTeam();
  const row = await db.query.taskPlanRows.findFirst({
    where: eq(taskPlanRows.id, rowId),
    columns: { id: true, planId: true, createdTaskId: true },
    with: {
      plan: {
        columns: { teamId: true },
        with: { project: { columns: { slug: true } } },
      },
    },
  });
  if (!row || row.plan?.teamId !== teamId) {
    throw new Error("Plan row not found");
  }
  // Already-executed rows (have a created task) shouldn't toggle —
  // unapproving wouldn't undo the task and would just confuse the
  // UI state. Silently no-op so optimistic clicks don't error.
  if (row.createdTaskId) return;

  await db
    .update(taskPlanRows)
    .set({
      approvedAt: approved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(taskPlanRows.id, rowId));

  if (row.plan.project?.slug) {
    revalidatePath(`/p/${row.plan.project.slug}/plans/${row.planId}`);
  }
}

/* ─── bulk create tasks from approved rows ──────── */

export interface MaterialiseApprovedRowsResult {
  createdCount: number;
  taskIds: string[];
}

/**
 * Read every approved-but-not-yet-executed row in the plan, insert a
 * real `tasks` row for each, and stamp `task_plan_rows.created_task_id`
 * with the new id. Wrapped in a single transaction so we never end up
 * with half a plan executed.
 *
 * Permission gate: caller must be on the plan's team. The plan's
 * default board is used (one place where plans converge with the
 * task board UX) — a future iteration could let the user pick.
 */
export async function materialiseApprovedRows(
  planId: string,
): Promise<MaterialiseApprovedRowsResult> {
  const { session, teamId } = await requireActiveTeam();

  const plan = await db.query.taskPlans.findFirst({
    where: and(eq(taskPlans.id, planId), eq(taskPlans.teamId, teamId)),
    columns: { id: true, title: true, projectId: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!plan) throw new Error("Plan not found");

  const defaultBoard = await ensureDefaultTaskBoard(plan.projectId);

  const approvedRows = await db
    .select()
    .from(taskPlanRows)
    .where(
      and(
        eq(taskPlanRows.planId, plan.id),
        isNotNull(taskPlanRows.approvedAt),
        isNull(taskPlanRows.createdTaskId),
      ),
    )
    .orderBy(asc(taskPlanRows.position));

  if (approvedRows.length === 0) {
    return { createdCount: 0, taskIds: [] };
  }

  // Use the WebSocket-backed client here — Neon's HTTP driver
  // doesn't support interactive transactions, and we need atomic
  // commit across the bulk insert + per-row updates + plan status
  // flip. The default `db` (HTTP) is still used for the read
  // queries above; only the writes need the WS pool.
  const taskIds = await dbTx.transaction(async (tx) => {
    const inserted = await tx
      .insert(tasks)
      .values(
        approvedRows.map((row) => ({
          teamId,
          projectId: plan.projectId,
          taskBoardId: defaultBoard.id,
          creatorId: session.user.id,
          assigneeId: row.assigneeId,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          dueDate: row.dueDate,
          completedAt: row.status === "done" ? new Date() : null,
        })),
      )
      .returning({ id: tasks.id });

    // Pair each created task with its source row in input order — we
    // sorted both by position so the indices line up.
    await Promise.all(
      inserted.map((task, index) =>
        tx
          .update(taskPlanRows)
          .set({ createdTaskId: task.id, updatedAt: new Date() })
          .where(eq(taskPlanRows.id, approvedRows[index]!.id)),
      ),
    );

    // If every row in the plan now has a created task, mark the plan
    // executed. Otherwise it stays draft so the user knows there's
    // still work to approve.
    const remaining = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(taskPlanRows)
      .where(
        and(
          eq(taskPlanRows.planId, plan.id),
          isNull(taskPlanRows.createdTaskId),
        ),
      );
    const remainingCount = remaining[0]?.count ?? 0;
    await tx
      .update(taskPlans)
      .set({
        status: remainingCount === 0 ? "executed" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(taskPlans.id, plan.id));

    return inserted.map((t) => t.id);
  });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "executed",
    subjectType: "task_plan",
    subjectId: plan.id,
    subjectName: plan.title,
    metadata: { createdCount: taskIds.length, taskIds },
  });

  if (plan.project?.slug) {
    revalidatePath(`/p/${plan.project.slug}/plans/${plan.id}`);
    revalidatePath(`/p/${plan.project.slug}/tasks`);
  }
  // Re-index the plan (row.createdTaskId values just got stamped)
  // and each fresh task so the brain has them immediately.
  after(() => indexTaskPlan(plan.id));
  for (const id of taskIds) {
    after(() => indexTask(id));
  }
  return { createdCount: taskIds.length, taskIds };
}

/* ─── reads ───────────────────────────────────────── */

export async function listPlansForProject(
  projectId: string,
): Promise<TaskPlanSummary[]> {
  const rows = await db.query.taskPlans.findMany({
    where: eq(taskPlans.projectId, projectId),
    orderBy: [desc(taskPlans.updatedAt)],
    with: {
      author: { columns: { id: true, name: true } },
      sourceNote: { columns: { id: true, title: true } },
      rows: {
        columns: { id: true, approvedAt: true, createdTaskId: true },
      },
    },
  });

  return rows.map((r) => {
    const rowCount = r.rows.length;
    const approvedRowCount = r.rows.filter(
      (row) => row.approvedAt && !row.createdTaskId,
    ).length;
    const executedRowCount = r.rows.filter(
      (row) => row.createdTaskId,
    ).length;
    return {
      id: r.id,
      title: r.title,
      status: r.status as TaskPlanStatus,
      authorId: r.authorId,
      authorName: r.author?.name ?? null,
      rowCount,
      approvedRowCount,
      executedRowCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sourceNoteId: r.sourceNoteId,
      sourceNoteTitle: r.sourceNote?.title ?? null,
    };
  });
}

export async function getPlan(planId: string): Promise<TaskPlanDetail> {
  const { teamId } = await requireActiveTeam();

  const row = await db.query.taskPlans.findFirst({
    where: and(eq(taskPlans.id, planId), eq(taskPlans.teamId, teamId)),
    with: {
      author: { columns: { id: true, name: true } },
      project: { columns: { id: true, slug: true } },
      sourceNote: { columns: { id: true, title: true, body: true } },
      rows: {
        orderBy: [asc(taskPlanRows.position)],
        with: { assignee: { columns: { id: true, name: true } } },
      },
    },
  });
  if (!row) throw new Error("Plan not found");

  const approvedRowCount = row.rows.filter(
    (r) => r.approvedAt && !r.createdTaskId,
  ).length;
  const executedRowCount = row.rows.filter((r) => r.createdTaskId).length;

  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskPlanStatus,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    rowCount: row.rows.length,
    approvedRowCount,
    executedRowCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceNoteId: row.sourceNoteId,
    sourceNoteTitle: row.sourceNote?.title ?? null,
    threadId: row.threadId,
    projectId: row.project?.id ?? "",
    projectSlug: row.project?.slug ?? "",
    agentMeta: row.agentMeta,
    sourceNote: row.sourceNote
      ? {
          id: row.sourceNote.id,
          title: row.sourceNote.title,
          bodyPreview:
            row.sourceNote.body.length > 600
              ? `${row.sourceNote.body.slice(0, 600)}…`
              : row.sourceNote.body,
        }
      : null,
    rows: row.rows.map((r) => ({
      id: r.id,
      position: r.position,
      title: r.title,
      description: r.description,
      status: r.status as TaskStatus,
      priority: r.priority as TaskPriority,
      assigneeId: r.assigneeId,
      assigneeName: r.assignee?.name ?? null,
      dueDate: r.dueDate,
      approvedAt: r.approvedAt,
      createdTaskId: r.createdTaskId,
    })),
  };
}

/* ─── batch helpers used by the rows UI ─────────── */

export async function setPlanRowsApproval(
  rowIds: string[],
  approved: boolean,
): Promise<void> {
  if (rowIds.length === 0) return;
  const { teamId } = await requireActiveTeam();

  // Permission gate: filter to rows whose plan belongs to the active
  // team. Anything outside that gets dropped silently — same shape as
  // setPlanRowApproval.
  const rows = await db.query.taskPlanRows.findMany({
    where: inArray(taskPlanRows.id, rowIds),
    columns: { id: true, planId: true, createdTaskId: true },
    with: {
      plan: {
        columns: { teamId: true },
        with: { project: { columns: { slug: true } } },
      },
    },
  });
  const valid = rows.filter(
    (r) => r.plan?.teamId === teamId && !r.createdTaskId,
  );
  if (valid.length === 0) return;

  await db
    .update(taskPlanRows)
    .set({
      approvedAt: approved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        taskPlanRows.id,
        valid.map((r) => r.id),
      ),
    );

  // Revalidate every distinct plan touched (usually just one).
  const planSlugs = new Set<string>();
  valid.forEach((r) => {
    if (r.plan?.project?.slug) {
      planSlugs.add(`/p/${r.plan.project.slug}/plans/${r.planId}`);
    }
  });
  planSlugs.forEach((p) => revalidatePath(p));
}
