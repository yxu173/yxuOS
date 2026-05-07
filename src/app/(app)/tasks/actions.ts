"use server";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { member, tasks } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveTeam } from "@/lib/permissions";
import {
  isValidPriority,
  isValidStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/task-types";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 16_000;

/* ─── helpers ─────────────────────────────────────────── */

async function ensureTeammate(teamId: string, userId: string): Promise<void> {
  const row = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, teamId),
    ),
    columns: { id: true },
  });
  if (!row) {
    throw new Error("Assignee is not a member of this team");
  }
}

async function getTaskOrThrow(taskId: string, teamId: string) {
  const row = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)),
    columns: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      parentTaskId: true,
      teamId: true,
      creatorId: true,
    },
  });
  if (!row) throw new Error("Task not found");
  return row;
}

/* ─── create ──────────────────────────────────────────── */

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  parentTaskId?: string | null;
  dueDate?: Date | null;
  /** When true, redirect to /tasks/{id} after creating. */
  redirectAfter?: boolean;
}

export async function createTask(
  input: CreateTaskInput,
): Promise<{ id: string }> {
  const { session, teamId } = await requireActiveTeam();

  const title = input.title.trim().slice(0, MAX_TITLE);
  if (!title) throw new Error("Task title is required");

  const description =
    input.description?.trim().slice(0, MAX_DESCRIPTION) || null;

  const status: TaskStatus =
    input.status && isValidStatus(input.status) ? input.status : "todo";
  const priority: TaskPriority =
    input.priority && isValidPriority(input.priority)
      ? input.priority
      : "medium";

  if (input.assigneeId) {
    await ensureTeammate(teamId, input.assigneeId);
  }

  // Subtask parent must live on the same team — preserve the team boundary.
  if (input.parentTaskId) {
    const parent = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, input.parentTaskId),
        eq(tasks.teamId, teamId),
      ),
      columns: { id: true, parentTaskId: true },
    });
    if (!parent) throw new Error("Parent task not found");
    // Keep depth at 1 — Linear-style: subtasks don't nest further.
    if (parent.parentTaskId) {
      throw new Error("Sub-tasks can't have their own sub-tasks");
    }
  }

  const [created] = await db
    .insert(tasks)
    .values({
      teamId,
      creatorId: session.user.id,
      assigneeId: input.assigneeId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title,
      description,
      status,
      priority,
      dueDate: input.dueDate ?? null,
      completedAt: status === "done" ? new Date() : null,
    })
    .returning({ id: tasks.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "task",
    subjectId: created.id,
    subjectName: title,
    metadata: {
      assigneeId: input.assigneeId ?? null,
      parentTaskId: input.parentTaskId ?? null,
    },
  });

  revalidatePath("/tasks");
  if (input.parentTaskId) {
    revalidatePath(`/tasks/${input.parentTaskId}`);
  }

  if (input.redirectAfter) {
    redirect(`/tasks/${created.id}`);
  }

  return { id: created.id };
}

/* ─── update ──────────────────────────────────────────── */

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** Set null to unassign. Undefined = don't change. */
  assigneeId?: string | null;
  /** Set null to clear the due date. Undefined = don't change. */
  dueDate?: Date | null;
}

export async function updateTask(
  input: UpdateTaskInput,
): Promise<{ id: string }> {
  const { session, teamId } = await requireActiveTeam();
  const existing = await getTaskOrThrow(input.taskId, teamId);

  // Build the patch and the activity log payload side by side.
  const patch: Partial<typeof tasks.$inferInsert> = {
    updatedAt: new Date(),
  };
  const changedKeys: string[] = [];

  if (input.title !== undefined) {
    const trimmed = input.title.trim().slice(0, MAX_TITLE);
    if (!trimmed) throw new Error("Task title can't be empty");
    if (trimmed !== existing.title) {
      patch.title = trimmed;
      changedKeys.push("title");
    }
  }

  if (input.description !== undefined) {
    patch.description = input.description?.trim().slice(0, MAX_DESCRIPTION) || null;
    changedKeys.push("description");
  }

  if (input.status !== undefined) {
    if (!isValidStatus(input.status)) {
      throw new Error(`Unknown status "${input.status}"`);
    }
    if (input.status !== existing.status) {
      patch.status = input.status;
      patch.completedAt = input.status === "done" ? new Date() : null;
      changedKeys.push("status");
    }
  }

  if (input.priority !== undefined) {
    if (!isValidPriority(input.priority)) {
      throw new Error(`Unknown priority "${input.priority}"`);
    }
    if (input.priority !== existing.priority) {
      patch.priority = input.priority;
      changedKeys.push("priority");
    }
  }

  if (input.assigneeId !== undefined) {
    if (input.assigneeId) {
      await ensureTeammate(teamId, input.assigneeId);
    }
    if (input.assigneeId !== existing.assigneeId) {
      patch.assigneeId = input.assigneeId;
      changedKeys.push("assignee");
    }
  }

  if (input.dueDate !== undefined) {
    patch.dueDate = input.dueDate;
    changedKeys.push("dueDate");
  }

  if (changedKeys.length === 0) {
    return { id: input.taskId };
  }

  await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)));

  // Pick the most informative verb. Status changes get their own verb so
  // the activity feed reads naturally ("Alice moved Task to In Progress").
  let verb: "updated" | "renamed" | "reassigned" | "status_changed" = "updated";
  if (changedKeys.length === 1) {
    if (changedKeys[0] === "title") verb = "renamed";
    else if (changedKeys[0] === "assignee") verb = "reassigned";
    else if (changedKeys[0] === "status") verb = "status_changed";
  }

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb,
    subjectType: "task",
    subjectId: input.taskId,
    subjectName: patch.title ?? existing.title,
    metadata: {
      changed: changedKeys,
      ...(patch.status ? { status: patch.status } : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId }
        : {}),
    },
  });

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${input.taskId}`);
  if (existing.parentTaskId) {
    revalidatePath(`/tasks/${existing.parentTaskId}`);
  }

  return { id: input.taskId };
}

/* ─── delete ──────────────────────────────────────────── */

export async function deleteTask(taskId: string): Promise<void> {
  const { session, teamId } = await requireActiveTeam();
  const existing = await getTaskOrThrow(taskId, teamId);

  await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "task",
    subjectId: taskId,
    subjectName: existing.title,
  });

  revalidatePath("/tasks");
  if (existing.parentTaskId) {
    revalidatePath(`/tasks/${existing.parentTaskId}`);
  }
}

/* ─── list / read helpers ─────────────────────────────── */

export interface TaskListRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  updatedAt: Date;
  parentTaskId: string | null;
  assignee: {
    id: string;
    name: string;
    username: string | null;
  } | null;
  /** Subtask count on the same team. 0 for tasks without subtasks. */
  subtaskCount: number;
  doneSubtaskCount: number;
}

/**
 * Loads every top-level task on a team plus a quick subtask count summary.
 * Subtasks are surfaced inside each task's detail page, not in the list,
 * so flattening would just create noise.
 */
export async function listTopLevelTasks(
  teamId: string,
): Promise<TaskListRow[]> {
  const rows = await db.query.tasks.findMany({
    where: and(eq(tasks.teamId, teamId), isNull(tasks.parentTaskId)),
    orderBy: desc(tasks.updatedAt),
    with: {
      assignee: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
  });

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const subtaskRows = await db
    .select({
      parentTaskId: tasks.parentTaskId,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(eq(tasks.teamId, teamId), inArray(tasks.parentTaskId, ids)),
    );

  const counts = new Map<string, { total: number; done: number }>();
  for (const row of subtaskRows) {
    if (!row.parentTaskId) continue;
    const entry = counts.get(row.parentTaskId) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === "done") entry.done += 1;
    counts.set(row.parentTaskId, entry);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueDate: row.dueDate,
    updatedAt: row.updatedAt,
    parentTaskId: row.parentTaskId,
    assignee: row.assignee
      ? {
          id: row.assignee.id,
          name: row.assignee.name,
          username:
            row.assignee.displayUsername ?? row.assignee.username ?? null,
        }
      : null,
    subtaskCount: counts.get(row.id)?.total ?? 0,
    doneSubtaskCount: counts.get(row.id)?.done ?? 0,
  }));
}

/* ─── single task with subtasks ───────────────────────── */

export interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  parentTask: {
    id: string;
    title: string;
  } | null;
  creator: {
    id: string;
    name: string;
    username: string | null;
  };
  assignee: {
    id: string;
    name: string;
    username: string | null;
  } | null;
  subtasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: {
      id: string;
      name: string;
      username: string | null;
    } | null;
  }>;
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const { teamId } = await requireActiveTeam();

  const row = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)),
    with: {
      creator: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
      assignee: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
      parent: { columns: { id: true, title: true } },
    },
  });
  if (!row) return null;

  const subtaskRows = await db.query.tasks.findMany({
    where: and(eq(tasks.parentTaskId, taskId), eq(tasks.teamId, teamId)),
    orderBy: asc(tasks.createdAt),
    with: {
      assignee: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
  });

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    parentTask: row.parent ? { id: row.parent.id, title: row.parent.title } : null,
    creator: {
      id: row.creator.id,
      name: row.creator.name,
      username: row.creator.displayUsername ?? row.creator.username ?? null,
    },
    assignee: row.assignee
      ? {
          id: row.assignee.id,
          name: row.assignee.name,
          username:
            row.assignee.displayUsername ?? row.assignee.username ?? null,
        }
      : null,
    subtasks: subtaskRows.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status as TaskStatus,
      priority: s.priority as TaskPriority,
      assignee: s.assignee
        ? {
            id: s.assignee.id,
            name: s.assignee.name,
            username: s.assignee.displayUsername ?? s.assignee.username ?? null,
          }
        : null,
    })),
  };
}
