import { db } from "@/db";
import { activityLog } from "@/db/schema";

/**
 * Verbs are free text by design — extending without a migration is more
 * valuable than the type-narrowing. The constants here document what the
 * UI knows how to render with a friendly icon / sentence; anything else
 * falls back to a generic "Actor verbed Subject" rendering.
 */
export type ActivityVerb =
  | "created"
  | "renamed"
  | "updated"
  | "deleted"
  | "shared"
  | "unshared"
  | "commented"
  | "reassigned"
  | "status_changed"
  | "added_member"
  | "removed_member"
  | "left"
  | "renamed_team";

export type ActivitySubjectType =
  | "board"
  | "design"
  | "comment"
  | "member"
  | "team"
  | "task";

export interface LogActivityInput {
  teamId: string;
  actorId: string;
  verb: ActivityVerb;
  subjectType: ActivitySubjectType;
  subjectId: string;
  /** Snapshot of the subject name. Stored as-is so the feed survives deletes. */
  subjectName?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort write to the activity feed. Failures are swallowed because
 * a missed feed entry should never break the underlying mutation —
 * imagine a board create succeeding but the redirect failing because we
 * couldn't insert an activity row. The cost of an audit miss is much
 * lower than the cost of a 500.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      teamId: input.teamId,
      actorId: input.actorId,
      verb: input.verb,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectName: input.subjectName ?? null,
      metadata: input.metadata,
    });
  } catch (err) {
    console.warn("[activity] failed to log:", err);
  }
}
