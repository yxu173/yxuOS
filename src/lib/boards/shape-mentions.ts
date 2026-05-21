import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { member, user } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { getRedis } from "@/lib/cache/redis";

const MENTION_RE = /@([a-zA-Z0-9_.]{3,30})/g;
const SEEN_TTL = 60 * 60 * 24; // 24 h — dedupe mentioned shape+user pairs for a day

/**
 * Extract all `@username` mentions from text elements in an Excalidraw
 * snapshot. Returns deduped lowercased handles.
 */
function extractMentionHandlesFromSnapshot(
  snapshot: Record<string, unknown>,
): string[] {
  const handles = new Set<string>();
  const elements = snapshot.elements as
    | { type?: string; text?: string; name?: string }[]
    | undefined;
  if (!Array.isArray(elements)) return [];

  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const text = el.type === "text" ? (el.text ?? "") : (el.name ?? "");
    if (!text) continue;
    for (const match of text.matchAll(MENTION_RE)) {
      handles.add(match[1].toLowerCase());
    }
  }

  return Array.from(handles);
}

/**
 * Resolve mention handles to user IDs that belong to the given team.
 */
async function resolveHandlesForTeam(
  handles: string[],
  teamId: string,
): Promise<string[]> {
  if (handles.length === 0) return [];

  const candidates = await db.query.user.findMany({
    where: inArray(user.username, handles),
    columns: { id: true },
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const teamMembers = await db.query.member.findMany({
    where: inArray(member.userId, ids),
    columns: { userId: true, organizationId: true },
  });
  const teammates = new Set(
    teamMembers
      .filter((m) => m.organizationId === teamId)
      .map((m) => m.userId),
  );
  return ids.filter((id) => teammates.has(id));
}

/**
 * Process mentions in a board snapshot on save. Extracts `@username`
 * patterns from text elements, resolves them to team members, and logs
 * activity for new mentions. Previously-seen mention pairs are
 * deduped via Redis with a 24 h TTL.
 */
export async function processShapeMentions(
  boardId: string,
  snapshot: Record<string, unknown>,
  teamId: string,
  actorId: string,
): Promise<void> {
  const handles = extractMentionHandlesFromSnapshot(snapshot);
  if (handles.length === 0) return;

  const mentionedIds = await resolveHandlesForTeam(handles, teamId);
  if (mentionedIds.length === 0) return;

  const redis = getRedis();

  for (const mentionedId of mentionedIds) {
    if (mentionedId === actorId) continue;

    // Dedupe: don't notify the same user twice on the same board
    if (redis) {
      const seenKey = `mention:board:${boardId}:user:${mentionedId}`;
      const seen = await redis.exists(seenKey);
      if (seen) continue;
      await redis.set(seenKey, "1", { ex: SEEN_TTL });
    }

    await logActivity({
      teamId,
      actorId,
      verb: "mentioned",
      subjectType: "board",
      subjectId: boardId,
      subjectName: null,
      metadata: { mentionedUserId: mentionedId },
    });
  }
}
