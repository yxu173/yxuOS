import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { boards, designs, projects } from "@/db/schema";
import {
  boardSnapshotToDigest,
  type RawBoardSnapshot,
} from "@/lib/boards/snapshot-digest";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";

/** Per-message hard cap on the combined digest text. ~3 boards × 6 KB. */
const MAX_TOTAL_DIGEST_BYTES = 18 * 1024;
/** Maximum number of mentioned boards we'll digest in a single turn. */
const MAX_MENTIONS_PER_MESSAGE = 3;

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
  const design = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
    columns: { id: true, threadId: true },
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

  // Pull the mentioned-boards list off the body. The client passes it
  // alongside the messages via `sendMessage(msg, { body: { ... } })`.
  // It is the client's job to deduplicate; we still cap defensively.
  const mentionedBoardIds = parseBoardIds(body?.mentionedBoardIds).slice(
    0,
    MAX_MENTIONS_PER_MESSAGE,
  );

  // Build a single digest blob — only when there are mentions AND we
  // can find a fresh user message to inject into.
  if (mentionedBoardIds.length > 0) {
    const digest = await buildDigestBlob(teamId, mentionedBoardIds);
    if (digest) {
      injectDigestIntoLastUserMessage(body, digest);
    }
  }

  const stream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "designArchitect",
    params: {
      ...body,
      memory: {
        ...(body?.memory ?? {}),
        thread: design.threadId,
        resource: session.user.id,
      },
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/* ─── helpers ──────────────────────────────────────────── */

function parseBoardIds(value: unknown): string[] {
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
 * Look up every mentioned board, verify it belongs to the active team
 * (defense in depth — the client could send any id), build per-board
 * digests, then concatenate into a single block. Boards we can't find
 * or that aren't ours are silently dropped: we'd rather degrade
 * gracefully than fail the whole chat turn over one stale chip.
 */
async function buildDigestBlob(
  teamId: string,
  ids: string[],
): Promise<string | null> {
  if (ids.length === 0) return null;

  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      projectId: boards.projectId,
      snapshot: boards.snapshot,
      updatedAt: boards.updatedAt,
    })
    .from(boards)
    .where(and(eq(boards.teamId, teamId), inArray(boards.id, ids)));
  if (rows.length === 0) return null;

  const projectIds = Array.from(
    new Set(rows.map((r) => r.projectId).filter((v): v is string => !!v)),
  );
  const projectRows =
    projectIds.length > 0
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [];
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));

  // Preserve the order the user mentioned them — the order is part of
  // their intent ("look at the auth board first, then the dashboard").
  const byId = new Map(rows.map((r) => [r.id, r]));

  const blocks: string[] = [];
  let bytes = 0;
  for (const id of ids) {
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
      // Tighter per-board cap when there are several — keeps the
      // first board readable even if it's huge.
      { maxBytes: Math.floor(MAX_TOTAL_DIGEST_BYTES / Math.max(1, ids.length)) },
    );
    // Last-line defense against the per-message cap: if the next
    // block would push us over, stop appending and surface an
    // honest truncation marker so the agent doesn't think the user
    // only mentioned the first N.
    if (bytes + block.length > MAX_TOTAL_DIGEST_BYTES) {
      blocks.push(
        `[mentioned-boards-truncated] ${ids.length - blocks.length} more board(s) omitted to fit the message budget`,
      );
      break;
    }
    blocks.push(block);
    bytes += block.length;
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
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
 *     user asks a follow-up referencing the same board, the agent
 *     still has the content in context.
 *   - The client renders chips from a separate `data-mentioned-boards`
 *     part so the user doesn't see the raw digest text in their own
 *     message bubble. (See design-chat.tsx for that filter.)
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

    // Locate the first text part to extend. If the user only sent
    // attachments + chips (no typed text), we synthesize a text part
    // so the digest still rides along.
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
