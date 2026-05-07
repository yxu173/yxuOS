import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { member, user } from "@/db/schema";

/** Match `@username` where username is the same charset Better Auth's `username` plugin allows. */
const MENTION_RE = /@([a-zA-Z0-9_.]{3,30})/g;

/**
 * Pulls every unique handle out of a comment body and returns the
 * (subset of) user ids that:
 *   1. Match a real `username` in the user table.
 *   2. Are members of the same team as the commenter.
 *
 * Non-team handles get silently dropped — that prevents a comment from
 * notifying random strangers if someone fat-fingers a mention.
 */
export async function resolveMentionsForTeam(
  body: string,
  teamId: string,
): Promise<string[]> {
  const handles = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    handles.add(match[1].toLowerCase());
  }
  if (handles.size === 0) return [];

  const candidates = await db.query.user.findMany({
    where: inArray(user.username, Array.from(handles)),
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

/** Bare list of every `@handle` in a body (deduped, lowercased) — used to render highlights without a DB lookup. */
export function extractMentionHandles(body: string): string[] {
  const set = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    set.add(match[1].toLowerCase());
  }
  return Array.from(set);
}
