import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { projects, tasks } from "@/db/schema";

import type { TaskPriority, TaskStatus } from "./task-types";

export interface MyTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  /** Pre-computed at fetch time so the page render stays pure. */
  overdue: boolean;
  parentTaskId: string | null;
  /** Slug of the project the task lives in — used to build /p/<slug>/tasks/<id> links. */
  projectSlug: string | null;
}

/**
 * Lists open tasks assigned to `userId` on `teamId`, oldest-due first
 * with no due date last. "Open" excludes done and canceled — those don't
 * belong on a "what's on your plate today" widget.
 */
export async function listMyOpenTasks(
  userId: string,
  teamId: string,
  limit = 6,
): Promise<MyTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      parentTaskId: tasks.parentTaskId,
      projectSlug: projects.slug,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.teamId, teamId),
        eq(tasks.assigneeId, userId),
        ne(tasks.status, "done"),
        ne(tasks.status, "canceled"),
      ),
    )
    // Drizzle doesn't expose NULLS LAST shorthand cross-dialect, but
    // Postgres's default ordering for ASC puts NULLs last anyway when
    // we sort on a nullable column.
    .orderBy(asc(tasks.dueDate), asc(tasks.priority))
    .limit(limit);

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueDate: row.dueDate,
    overdue: row.dueDate ? row.dueDate.getTime() < now : false,
    parentTaskId: row.parentTaskId,
    projectSlug: row.projectSlug,
  }));
}
