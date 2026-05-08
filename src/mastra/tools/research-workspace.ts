import { createTool } from "@mastra/core/tools";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  boards,
  designs,
  projects,
  researchNotes,
  tasks,
} from "@/db/schema";
import {
  boardSnapshotToDigest,
  type RawBoardSnapshot,
} from "@/lib/boards/snapshot-digest";

import { toolResultSchema } from "./_envelope";

/**
 * Workspace-context tools for the Researcher agent. Every tool is
 * **scoped to one project** — the project id comes from the agent's
 * runtime context (see `/api/research-chat/[noteId]/route.ts`), not
 * from tool input, so the agent literally cannot read a sibling
 * project's data. This is the same defense-in-depth pattern the
 * design-architect's mention pipeline uses.
 */

/** Runtime context every research tool can read. */
export interface ResearchToolContext {
  /** Owning team — the cross-cutting permission boundary. */
  teamId: string;
  /** Project the active note belongs to. */
  projectId: string;
  /** The note id, so write tools mutate the right row. */
  noteId: string;
}

/**
 * Read the {@link ResearchToolContext} off the Mastra `requestContext`
 * the route handler attached to this turn. Throwing here — rather
 * than returning a structured error — is the right move because a
 * missing context is a programmer error in our routing code, not
 * something the agent can recover from.
 */
function readResearchContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): ResearchToolContext {
  const requestContext = ctx?.requestContext;
  if (!requestContext || typeof requestContext.get !== "function") {
    throw new Error(
      "research tools require a `requestContext` on the Mastra invocation",
    );
  }
  const value = requestContext.get("research") as ResearchToolContext | null;
  if (!value || !value.teamId || !value.projectId || !value.noteId) {
    throw new Error(
      "research tool context is missing teamId / projectId / noteId",
    );
  }
  return value;
}

/* ─── list_project_boards ─────────────────────────── */

const listBoardsInput = z.object({
  q: z
    .string()
    .max(120)
    .optional()
    .describe(
      "Optional case-insensitive filter on the board name. Omit to list all boards in the project.",
    ),
});

const listBoardsData = z.object({
  boards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export const listProjectBoardsTool = createTool({
  id: "list_project_boards",
  description:
    "List every whiteboard in the current project. Returns id, name, and last-edited date. Use as the first step of any board-related research turn so the agent doesn't ask the user 'which board?' when it could just look.",
  inputSchema: listBoardsInput,
  outputSchema: toolResultSchema(listBoardsData),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);
    const where = and(
      eq(boards.teamId, ctx.teamId),
      eq(boards.projectId, ctx.projectId),
      input.q ? ilike(boards.name, `%${input.q}%`) : undefined,
    );
    const rows = await db
      .select({ id: boards.id, name: boards.name, updatedAt: boards.updatedAt })
      .from(boards)
      .where(where)
      .orderBy(desc(boards.updatedAt))
      .limit(50);
    return {
      ok: true as const,
      data: {
        boards: rows.map((r) => ({
          id: r.id,
          name: r.name,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
    };
  },
});

/* ─── read_board ──────────────────────────────────── */

const readBoardInput = z.object({
  boardId: z.string().describe("Id from `list_project_boards`."),
});

const readBoardData = z.object({
  digest: z
    .string()
    .describe(
      "Plain-text digest of the board (frames, sticky notes, markdown cards, mermaid, connections). Same format the design agent reads when boards are @-mentioned.",
    ),
  bytes: z.number(),
});

export const readBoardTool = createTool({
  id: "read_board",
  description:
    "Fetch a verbatim digest of a board's contents — frames, sticky notes, text, geo labels, markdown cards (~~~ fenced), mermaid diagrams (~~~ fenced), and arrow connections. Use when the user references a board by name OR when `list_project_boards` reveals one that's likely relevant. Always cite as `[board:<name>]` in the note body.",
  inputSchema: readBoardInput,
  outputSchema: toolResultSchema(readBoardData),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);
    const row = await db.query.boards.findFirst({
      where: and(
        eq(boards.id, input.boardId),
        eq(boards.teamId, ctx.teamId),
        eq(boards.projectId, ctx.projectId),
      ),
      columns: {
        id: true,
        name: true,
        snapshot: true,
        updatedAt: true,
        projectId: true,
      },
    });
    if (!row) {
      return {
        ok: false as const,
        error: {
          code: "not_found" as const,
          message: "Board not found in this project.",
          hint: "Re-run `list_project_boards` — the id may be stale.",
        },
      };
    }
    const project = row.projectId
      ? await db.query.projects.findFirst({
          where: eq(projects.id, row.projectId),
          columns: { name: true },
        })
      : null;

    const digest = boardSnapshotToDigest({
      name: row.name,
      projectName: project?.name ?? null,
      snapshot: (row.snapshot as RawBoardSnapshot | null) ?? null,
      updatedAt: row.updatedAt,
    });

    return {
      ok: true as const,
      data: { digest, bytes: digest.length },
    };
  },
});

/* ─── list_project_designs ────────────────────────── */

const listDesignsData = z.object({
  designs: z.array(
    z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  ),
});

export const listProjectDesignsTool = createTool({
  id: "list_project_designs",
  description:
    "List every design in the current project (UI mockups produced by the Architect). Returns id, name, and last-edited date. Use to discover designs that might inform the research question — e.g. 'how do we currently render task rows' should look at task-page designs.",
  inputSchema: z.object({
    q: z.string().max(120).optional(),
  }),
  outputSchema: toolResultSchema(listDesignsData),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);
    const where = and(
      eq(designs.teamId, ctx.teamId),
      eq(designs.projectId, ctx.projectId),
      input.q ? ilike(designs.name, `%${input.q}%`) : undefined,
    );
    const rows = await db
      .select({
        id: designs.id,
        name: designs.name,
        updatedAt: designs.updatedAt,
      })
      .from(designs)
      .where(where)
      .orderBy(desc(designs.updatedAt))
      .limit(50);
    return {
      ok: true as const,
      data: {
        designs: rows.map((r) => ({
          id: r.id,
          name: r.name,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
    };
  },
});

/* ─── search_project_tasks ────────────────────────── */

const searchTasksData = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string(),
      /** First ~400 chars of description, plain text. */
      description: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

export const searchProjectTasksTool = createTool({
  id: "search_project_tasks",
  description:
    "Search tasks in the current project by title or description. Returns up to 25 matches with id, title, status, priority, and a clipped description. Use when the user asks 'have we tracked this before?', 'what tasks are open about X?', or to avoid duplicating work in a follow-up plan.",
  inputSchema: z.object({
    q: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Case-insensitive substring matched against title OR description.",
      ),
    statuses: z
      .array(
        z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]),
      )
      .optional()
      .describe(
        "Optional status filter. Omit to include all statuses.",
      ),
  }),
  outputSchema: toolResultSchema(searchTasksData),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);
    const like = `%${input.q}%`;
    const filter = and(
      eq(tasks.teamId, ctx.teamId),
      eq(tasks.projectId, ctx.projectId),
      or(ilike(tasks.title, like), ilike(tasks.description, like)),
    );

    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        description: tasks.description,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(filter)
      .orderBy(desc(tasks.updatedAt))
      .limit(25);

    return {
      ok: true as const,
      data: {
        tasks: rows
          .filter((r) =>
            input.statuses ? input.statuses.includes(r.status as never) : true,
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            priority: r.priority,
            description: r.description
              ? clipPlainText(r.description, 400)
              : null,
            updatedAt: r.updatedAt.toISOString(),
          })),
      },
    };
  },
});

/* ─── list_recent_notes ───────────────────────────── */

export const listRecentNotesTool = createTool({
  id: "list_recent_research_notes",
  description:
    "List recent research notes in this project (excluding the active one). Use to check whether a similar question has already been investigated — if so, cite the existing note instead of re-deriving the answer.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).default(10),
  }),
  outputSchema: toolResultSchema(
    z.object({
      notes: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          updatedAt: z.string(),
        }),
      ),
    }),
  ),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);
    const limit = input.limit ?? 10;
    const rows = await db
      .select({
        id: researchNotes.id,
        title: researchNotes.title,
        status: researchNotes.status,
        updatedAt: researchNotes.updatedAt,
      })
      .from(researchNotes)
      .where(
        and(
          eq(researchNotes.projectId, ctx.projectId),
          eq(researchNotes.teamId, ctx.teamId),
        ),
      )
      .orderBy(desc(researchNotes.updatedAt))
      .limit(limit + 1); // +1 to compensate for the active-note filter
    return {
      ok: true as const,
      data: {
        notes: rows
          .filter((r) => r.id !== ctx.noteId)
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            updatedAt: r.updatedAt.toISOString(),
          })),
      },
    };
  },
});

/* ─── update_research_note ───────────────────────── */

const updateNoteInput = z.object({
  title: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Suggested title for the note. Replaces the current one. Keep it short and specific (5-8 words).",
    ),
  body: z
    .string()
    .max(64 * 1024)
    .describe(
      "Full Markdown body of the note. REPLACES the current body — to add a section, include the existing body verbatim plus the new section. Use standard headings (`## Question`, `## Findings`, `## Options`, `## Recommendation`, `## Open questions`). Cite sources inline as `[board:<name>]`, `[task:<id>]`, or `[<exa-domain>](<url>)`.",
    ),
});

const updateNoteData = z.object({
  noteId: z.string(),
  bytes: z.number(),
});

export const updateResearchNoteTool = createTool({
  id: "update_research_note",
  description:
    "Replace the current note's title and/or body. The body is the SOURCE OF TRUTH for the note — don't just narrate findings in chat, write them into the note so they persist for the user's reference. Cite every claim. Replaces the body wholesale; include the existing content if you want to keep it.",
  inputSchema: updateNoteInput,
  outputSchema: toolResultSchema(updateNoteData),
  execute: async (input, ctxArg) => {
    const ctx = readResearchContext(ctxArg);

    const patch: Partial<typeof researchNotes.$inferInsert> = {
      body: input.body,
      updatedAt: new Date(),
    };
    if (typeof input.title === "string") {
      const trimmed = input.title.trim().slice(0, 200);
      if (trimmed) patch.title = trimmed;
    }

    const [updated] = await db
      .update(researchNotes)
      .set(patch)
      .where(
        and(
          eq(researchNotes.id, ctx.noteId),
          eq(researchNotes.teamId, ctx.teamId),
          eq(researchNotes.projectId, ctx.projectId),
        ),
      )
      .returning({ id: researchNotes.id });

    if (!updated) {
      return {
        ok: false as const,
        error: {
          code: "not_found" as const,
          message: "Active note not found.",
          hint: "The note may have been deleted by another tab.",
        },
      };
    }

    return {
      ok: true as const,
      data: { noteId: updated.id, bytes: input.body.length },
    };
  },
});

/* ─── helpers ─────────────────────────────────────── */

/**
 * Strip HTML tags + collapse whitespace + clip. The task `description`
 * column stores TipTap HTML; for the agent's purposes we want a flat
 * skim, not a structured render.
 */
function clipPlainText(input: string, max: number): string {
  const stripped = input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

// Suppress unused-import warning for `asc` — kept around because
// future tools (e.g. "earliest design first") will want it. Drop if
// still unused after slice 3.
void asc;

/* ─── bundle ──────────────────────────────────────── */

export const researchWorkspaceTools = {
  list_project_boards: listProjectBoardsTool,
  read_board: readBoardTool,
  list_project_designs: listProjectDesignsTool,
  search_project_tasks: searchProjectTasksTool,
  list_recent_research_notes: listRecentNotesTool,
  update_research_note: updateResearchNoteTool,
};
