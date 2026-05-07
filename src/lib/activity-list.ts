import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { activityLog } from "@/db/schema";

export interface ActivityListItem {
  id: string;
  verb: string;
  subjectType: string;
  subjectId: string;
  subjectName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actor: {
    id: string;
    name: string;
    username: string | null;
  };
}

/**
 * Reads the recent-activity feed for a team, joining each row with the
 * actor's user record so the UI can render avatars and names without an
 * extra round-trip.
 */
export async function listRecentActivity(
  teamId: string,
  limit = 30,
): Promise<ActivityListItem[]> {
  const rows = await db.query.activityLog.findMany({
    where: eq(activityLog.teamId, teamId),
    orderBy: desc(activityLog.createdAt),
    limit,
    with: {
      actor: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    verb: row.verb,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actor: {
      id: row.actor.id,
      name: row.actor.name,
      username: row.actor.displayUsername ?? row.actor.username,
    },
  }));
}
