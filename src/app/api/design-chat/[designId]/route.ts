import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStreamResponse } from "ai";

import { safeChatStream } from "@/lib/ai/safe-chat-stream";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  designs,
  projects,
  researchNotes,
  taskPlanRows,
  taskPlans,
} from "@/db/schema";
import {
  boardSnapshotToDigest,
  type RawBoardSnapshot,
} from "@/lib/boards/snapshot-digest";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";
import type { ProjectToolContext } from "@/mastra/tools/search-knowledge";

/** Per-message hard cap on the combined digest text. ~3 items × 6 KB. */
const MAX_TOTAL_DIGEST_BYTES = 18 * 1024;
/** Maximum number of mentioned items (any kind) we'll digest in a single turn. */
const MAX_MENTIONS_PER_MESSAGE = 3;

/** Per-research-note budget — keep notes from swamping a turn. */
const MAX_RESEARCH_NOTE_BYTES = 6 * 1024;

interface MentionsByKind {
  boards: string[];
  research: string[];
  plans: string[];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ designId: string }> },
) {
  const { designId } = await params;

  let teamId: string;
  let session: Awaited<ReturnType<typeof requireActiveTeam>>["session"];
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
    session = ctx.session;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Confirm the design exists and is owned by the active team.
  // Pull `projectId` too so the brain-search tool can scope every
  // retrieval to the right project.
  const design = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
    columns: { id: true, threadId: true, projectId: true },
  });
  if (!design) {
    return new Response("Not found", { status: 404 });
  }

  // We intentionally type body loosely (`any`) here — `handleChatStream`'s
  // `params` argument is a tagged-union of v5/v6 ChatStreamHandlerParams
  // and exact-typing the parsed body fights that overload more than it
  // helps. We pluck the bits we care about and validate them defensively.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await req.json()) as any;

  // Accept the new bucketed `mentions` shape, falling back to the
  // legacy `mentionedBoardIds` field so a stale client (cached SW,
  // mid-deploy) still works. Both arrive as freeform JSON; we validate
  // and trim defensively below.
  const mentions = mergeMentionShapes(
    body?.mentions,
    body?.mentionedBoardIds,
  );

  // Cap *across* kinds — three mentions is plenty in any combination.
  const ordered = orderAndCap(mentions, MAX_MENTIONS_PER_MESSAGE);

  if (totalCount(ordered) > 0) {
    const digest = await buildDigestBlob(teamId, ordered);
    if (digest) {
      injectDigestIntoLastUserMessage(body, digest);
    }
  }

  // Attach the `project` namespace when the design has one. Same
  // pattern as the board chat route — project-less designs (legacy)
  // can't call `search_project_knowledge`, which is fine.
  const requestContext = new RequestContext<{
    project: ProjectToolContext;
  }>();
  if (design.projectId) {
    requestContext.set("project", {
      teamId,
      projectId: design.projectId,
    });
  }

  const upstream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "designArchitect",
    params: {
      ...body,
      requestContext,
      memory: {
        ...(body?.memory ?? {}),
        thread: design.threadId,
        resource: session.user.id,
      },
    },
  });

  // Wrap the raw stream so mid-stream provider failures (429s, etc.)
  // surface as a plain-English message to the client instead of a
  // JSON-shaped AI_APICallError blob.
  return createUIMessageStreamResponse({ stream: safeChatStream(upstream) });
}

/* ─── helpers ──────────────────────────────────────────── */

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
}

/**
 * Merge the legacy + new client payload shapes into one canonical
 * bucketed structure. Either field may be missing or the wrong shape;
 * we don't throw, we just degrade to empty buckets.
 *
 *   - `mentions` (new):  `{ boards, research, plans }`
 *   - `mentionedBoardIds` (legacy): `string[]` → `{boards: …}`
 *
 * If both arrive, the new shape wins (the new client always sends
 * `mentions` — `mentionedBoardIds` is only set as a back-compat shim
 * carrying the same board ids).
 */
function mergeMentionShapes(
  newShape: unknown,
  legacyBoardIds: unknown,
): MentionsByKind {
  if (newShape && typeof newShape === "object") {
    const obj = newShape as Record<string, unknown>;
    return {
      boards: parseIdList(obj.boards),
      research: parseIdList(obj.research),
      plans: parseIdList(obj.plans),
    };
  }
  return {
    boards: parseIdList(legacyBoardIds),
    research: [],
    plans: [],
  };
}

function totalCount(m: MentionsByKind): number {
  return m.boards.length + m.research.length + m.plans.length;
}

/**
 * Cap the cross-kind mention list to `limit` total entries while
 * preserving the original interleaving as much as possible. The order
 * is the order the user mentioned them — we don't have access to that
 * here directly, so we round-robin across kinds.
 *
 * For a typical 1–3 mention message this reduces to "keep them all";
 * the cap only kicks in when someone tries to slip 5+ chips past us.
 */
function orderAndCap(
  m: MentionsByKind,
  limit: number,
): MentionsByKind {
  const out: MentionsByKind = { boards: [], research: [], plans: [] };
  let kept = 0;
  const cursors = { boards: 0, research: 0, plans: 0 };
  // Round-robin in {board, research, plan} order so a stack of board
  // mentions doesn't crowd out a single research mention.
  while (kept < limit) {
    let progress = false;
    for (const k of ["boards", "research", "plans"] as const) {
      if (kept >= limit) break;
      const cur = cursors[k];
      if (cur < m[k].length) {
        out[k].push(m[k][cur]);
        cursors[k] = cur + 1;
        kept += 1;
        progress = true;
      }
    }
    if (!progress) break;
  }
  return out;
}

/**
 * Build the per-message digest blob the agent will see prepended to
 * the user's text. One concatenated string. Boards first (legacy
 * agents recognise that block), then research, then plans. Each kind
 * has its own format optimised for the agent's reading style:
 *
 *   - Boards: `boardSnapshotToDigest` (sticky notes, frames, mermaid).
 *   - Research: title + Markdown body, capped per note.
 *   - Plans: title + row table (title · status · priority · note).
 *
 * The total budget is `MAX_TOTAL_DIGEST_BYTES`. If we'd overflow, we
 * truncate the next block and append a clear truncation marker so the
 * agent doesn't pretend the omitted content existed.
 */
async function buildDigestBlob(
  teamId: string,
  mentions: MentionsByKind,
): Promise<string | null> {
  const blocks: string[] = [];
  let bytes = 0;

  const append = (block: string): boolean => {
    if (!block) return true;
    if (bytes + block.length > MAX_TOTAL_DIGEST_BYTES) {
      blocks.push(
        `[mentioned-content-truncated] additional mentioned content omitted to fit the message budget`,
      );
      return false;
    }
    blocks.push(block);
    bytes += block.length;
    return true;
  };

  // Per-item byte budget — split the global cap across all mentions
  // so one giant board doesn't starve the others. Floor at 1 KB so a
  // wide spread still produces something readable.
  const totalMentions = totalCount(mentions);
  const perItemBudget = Math.max(
    1024,
    Math.floor(MAX_TOTAL_DIGEST_BYTES / Math.max(1, totalMentions)),
  );

  // ── Boards ──────────────────────────────────────────────────────
  if (mentions.boards.length > 0) {
    const rows = await db
      .select({
        id: boards.id,
        name: boards.name,
        projectId: boards.projectId,
        snapshot: boards.snapshot,
        updatedAt: boards.updatedAt,
      })
      .from(boards)
      .where(
        and(eq(boards.teamId, teamId), inArray(boards.id, mentions.boards)),
      );
    const projectIds = uniq(
      rows.map((r) => r.projectId).filter((v): v is string => !!v),
    );
    const projectRows =
      projectIds.length > 0
        ? await db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, projectIds))
        : [];
    const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const id of mentions.boards) {
      const row = byId.get(id);
      if (!row) continue;
      const block = boardSnapshotToDigest(
        {
          name: row.name,
          projectName: row.projectId
            ? (projectName.get(row.projectId) ?? null)
            : null,
          snapshot: (row.snapshot as RawBoardSnapshot | null) ?? null,
          updatedAt: row.updatedAt,
        },
        { maxBytes: perItemBudget },
      );
      if (!append(block)) return blocks.join("\n\n");
    }
  }

  // ── Research notes ──────────────────────────────────────────────
  if (mentions.research.length > 0) {
    const rows = await db
      .select({
        id: researchNotes.id,
        title: researchNotes.title,
        body: researchNotes.body,
        updatedAt: researchNotes.updatedAt,
      })
      .from(researchNotes)
      .where(
        and(
          eq(researchNotes.teamId, teamId),
          inArray(researchNotes.id, mentions.research),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of mentions.research) {
      const row = byId.get(id);
      if (!row) continue;
      const block = researchNoteToDigest(row, {
        maxBytes: Math.min(perItemBudget, MAX_RESEARCH_NOTE_BYTES),
      });
      if (!append(block)) return blocks.join("\n\n");
    }
  }

  // ── Plans ───────────────────────────────────────────────────────
  if (mentions.plans.length > 0) {
    const planRowsRaw = await db
      .select({
        id: taskPlans.id,
        title: taskPlans.title,
        status: taskPlans.status,
        updatedAt: taskPlans.updatedAt,
      })
      .from(taskPlans)
      .where(
        and(
          eq(taskPlans.teamId, teamId),
          inArray(taskPlans.id, mentions.plans),
        ),
      );
    const planById = new Map(planRowsRaw.map((p) => [p.id, p]));
    // Pull all rows for those plans in one round-trip; group in JS.
    const allRows =
      planRowsRaw.length > 0
        ? await db
            .select({
              planId: taskPlanRows.planId,
              position: taskPlanRows.position,
              title: taskPlanRows.title,
              description: taskPlanRows.description,
              status: taskPlanRows.status,
              priority: taskPlanRows.priority,
              approvedAt: taskPlanRows.approvedAt,
              createdTaskId: taskPlanRows.createdTaskId,
            })
            .from(taskPlanRows)
            .where(
              inArray(
                taskPlanRows.planId,
                planRowsRaw.map((p) => p.id),
              ),
            )
            .orderBy(asc(taskPlanRows.planId), asc(taskPlanRows.position))
        : [];
    const rowsByPlan = new Map<string, typeof allRows>();
    for (const r of allRows) {
      const arr = rowsByPlan.get(r.planId);
      if (arr) arr.push(r);
      else rowsByPlan.set(r.planId, [r]);
    }

    for (const id of mentions.plans) {
      const plan = planById.get(id);
      if (!plan) continue;
      const block = planToDigest(
        plan,
        rowsByPlan.get(id) ?? [],
        { maxBytes: perItemBudget },
      );
      if (!append(block)) return blocks.join("\n\n");
    }
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/**
 * Format a research note as a digest block. The agent prompts treat
 * `[research-note] …` as a quoted reference, so we lead with that tag.
 *
 *   [research-note "Auth migration spike"]
 *   Updated: 2026-05-08
 *
 *   <markdown body, possibly truncated>
 */
function researchNoteToDigest(
  row: { title: string; body: string; updatedAt: Date },
  opts: { maxBytes: number },
): string {
  const header = `[research-note "${row.title}"]\nUpdated: ${row.updatedAt.toISOString().slice(0, 10)}\n\n`;
  const remaining = Math.max(256, opts.maxBytes - header.length);
  const body = row.body ?? "";
  if (body.length <= remaining) return `${header}${body}`.trim();
  return `${header}${body.slice(0, remaining - 32)}\n…[truncated]`;
}

/**
 * Format a task plan + its rows as a digest block. We give the agent
 * the structural shape — title, status, then a compact row table —
 * because plans are about the row breakdown more than prose.
 *
 *   [plan "Wire up Liveblocks presence" · executed]
 *   Updated: 2026-05-08
 *
 *   1. Add Liveblocks provider [todo · high] (approved · executed)
 *      Wire the room init in `<DesignShell>`; presence avatars …
 *   2. …
 */
function planToDigest(
  plan: { title: string; status: string; updatedAt: Date },
  rows: ReadonlyArray<{
    position: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    approvedAt: Date | null;
    createdTaskId: string | null;
  }>,
  opts: { maxBytes: number },
): string {
  const header = `[plan "${plan.title}" · ${plan.status}]\nUpdated: ${plan.updatedAt.toISOString().slice(0, 10)}\nRows: ${rows.length}\n\n`;
  if (rows.length === 0) {
    return `${header}(no rows)`;
  }
  const lines: string[] = [];
  let bytes = header.length;
  for (const row of rows) {
    const tags: string[] = [`${row.status} · ${row.priority}`];
    if (row.approvedAt) tags.push("approved");
    if (row.createdTaskId) tags.push("executed");
    const tagStr = tags.join(" · ");
    const desc = row.description?.trim();
    const descLine = desc ? `\n   ${desc.replace(/\s+/g, " ").slice(0, 240)}` : "";
    const line = `${row.position + 1}. ${row.title} [${tagStr}]${descLine}`;
    if (bytes + line.length > opts.maxBytes) {
      lines.push(
        `…[plan rows truncated at ${row.position + 1}/${rows.length}]`,
      );
      break;
    }
    lines.push(line);
    bytes += line.length;
  }
  return `${header}${lines.join("\n")}`;
}

/**
 * Find the last user message in `body.messages` and prepend the
 * digest block to its first text part (creating one if needed).
 * Operates in place on the parsed body — `handleChatStream` consumes
 * the same object below.
 *
 * We intentionally write into the persisted user message (not a
 * detached transient) so:
 *   - The thread memory keeps the digest on later turns — when the
 *     user asks a follow-up referencing the same content, the agent
 *     still has it in context.
 *   - The client renders chips from a separate display path so the
 *     user doesn't see the raw digest text in their own message
 *     bubble.
 */
function injectDigestIntoLastUserMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  digest: string,
): void {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const parts = m.parts;
    if (!Array.isArray(parts)) return;

    const textIdx = parts.findIndex(
      (p: { type?: string } | null | undefined) => p && p.type === "text",
    );
    if (textIdx >= 0) {
      const part = parts[textIdx];
      const original = typeof part.text === "string" ? part.text : "";
      part.text = `${digest}\n\n${original}`.trim();
    } else {
      parts.unshift({ type: "text", text: digest });
    }
    return;
  }
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
