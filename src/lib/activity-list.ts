import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  activityLog,
  boards,
  designs,
  projects,
  tasks,
} from "@/db/schema";

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
  /**
   * Slug of the project the subject lives in, if applicable. Lets the
   * UI build deep links of the form `/p/<slug>/<section>/<id>` instead
   * of going through the legacy redirect.
   */
  projectSlug: string | null;
}

/**
 * Reads the recent-activity feed for a team. Joins each row with the
 * actor's user record so the UI can render avatars + names, and post-
 * processes board / design / task rows to attach the project slug they
 * live in (one round-trip per subject type, batched by id).
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

  // Group subject ids by type so we can fetch their project slugs in
  // bulk. The activity row's `metadata.kind === "folder"` flag is used
  // to skip rows that aren't real subjects (e.g. board folders write
  // activity rows with subjectType = "board" but the id points at a
  // folder, not a board).
  const boardIds = new Set<string>();
  const designIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const row of rows) {
    const isFolderEvent =
      typeof row.metadata === "object" &&
      row.metadata !== null &&
      "kind" in row.metadata &&
      ((row.metadata as Record<string, unknown>).kind === "folder" ||
        (row.metadata as Record<string, unknown>).kind === "board");
    if (isFolderEvent) continue;
    if (row.subjectType === "board") boardIds.add(row.subjectId);
    if (row.subjectType === "design") designIds.add(row.subjectId);
    if (row.subjectType === "task") taskIds.add(row.subjectId);
  }

  const slugBySubject = new Map<string, string>();

  if (boardIds.size > 0) {
    const slugs = await db
      .select({ id: boards.id, slug: projects.slug })
      .from(boards)
      .leftJoin(projects, eq(projects.id, boards.projectId))
      .where(inArray(boards.id, Array.from(boardIds)));
    for (const row of slugs) {
      if (row.slug) slugBySubject.set(`board:${row.id}`, row.slug);
    }
  }
  if (designIds.size > 0) {
    const slugs = await db
      .select({ id: designs.id, slug: projects.slug })
      .from(designs)
      .leftJoin(projects, eq(projects.id, designs.projectId))
      .where(inArray(designs.id, Array.from(designIds)));
    for (const row of slugs) {
      if (row.slug) slugBySubject.set(`design:${row.id}`, row.slug);
    }
  }
  if (taskIds.size > 0) {
    const slugs = await db
      .select({ id: tasks.id, slug: projects.slug })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.id, Array.from(taskIds)));
    for (const row of slugs) {
      if (row.slug) slugBySubject.set(`task:${row.id}`, row.slug);
    }
  }

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
    projectSlug:
      slugBySubject.get(`${row.subjectType}:${row.subjectId}`) ?? null,
  }));
}
