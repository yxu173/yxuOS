"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { taskBoards, tasks } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveProject } from "@/lib/permissions";

const MAX_NAME = 80;

/* ─── create ────────────────────────────────────── */

export interface CreateTaskBoardInput {
  projectSlug: string;
  name: string;
  color?: string | null;
}

export async function createTaskBoard(
  input: CreateTaskBoardInput,
): Promise<{ id: string }> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(input.projectSlug);

  const trimmed = input.name.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Task board name is required");

  const [created] = await db
    .insert(taskBoards)
    .values({
      projectId,
      name: trimmed,
      color: input.color ?? null,
    })
    .returning({ id: taskBoards.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "task",
    subjectId: created.id,
    subjectName: trimmed,
    metadata: { kind: "board" },
  });

  revalidatePath(`/p/${projectSlug}/tasks`);
  return { id: created.id };
}

/* ─── rename ────────────────────────────────────── */

export async function renameTaskBoard(
  taskBoardId: string,
  rawName: string,
): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);

  const board = await db.query.taskBoards.findFirst({
    where: eq(taskBoards.id, taskBoardId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!board) throw new Error("Task board not found");
  if (board.projectId !== projectId) {
    throw new Error("Task board belongs to a different project");
  }

  const trimmed = rawName.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Task board name is required");
  if (trimmed === board.name) return;

  await db
    .update(taskBoards)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(taskBoards.id, taskBoardId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "task",
    subjectId: taskBoardId,
    subjectName: trimmed,
    metadata: { kind: "board" },
  });

  revalidatePath(`/p/${projectSlug}/tasks`);
}

/* ─── delete ────────────────────────────────────── */

export async function deleteTaskBoard(taskBoardId: string): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);

  const board = await db.query.taskBoards.findFirst({
    where: eq(taskBoards.id, taskBoardId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!board) throw new Error("Task board not found");
  if (board.projectId !== projectId) {
    throw new Error("Task board belongs to a different project");
  }

  // Refuse to delete the project's last task board — every task needs
  // somewhere to live, even if just the implicit "All tasks" group.
  const remaining = await db.query.taskBoards.findMany({
    where: eq(taskBoards.projectId, projectId),
    columns: { id: true },
  });
  if (remaining.length <= 1) {
    throw new Error(
      "Can't delete the project's last task board. Create another one first or rename this one.",
    );
  }

  // Tasks set null on board delete (configured in the schema). They
  // resurface in the "All tasks" view until moved to another board.
  await db.delete(taskBoards).where(eq(taskBoards.id, taskBoardId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "task",
    subjectId: taskBoardId,
    subjectName: board.name,
    metadata: { kind: "board" },
  });

  revalidatePath(`/p/${projectSlug}/tasks`);
}

/* ─── move task to board ────────────────────────── */

export async function moveTaskToBoard(
  taskId: string,
  taskBoardId: string | null,
): Promise<void> {
  const { teamId, projectId, projectSlug, session } =
    await requireActiveProject(null);

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)),
    columns: { id: true, title: true, projectId: true },
  });
  if (!task) throw new Error("Task not found");
  if (task.projectId !== projectId) {
    throw new Error("Task belongs to a different project");
  }

  if (taskBoardId) {
    const board = await db.query.taskBoards.findFirst({
      where: and(
        eq(taskBoards.id, taskBoardId),
        eq(taskBoards.projectId, projectId),
      ),
      columns: { id: true },
    });
    if (!board) throw new Error("Task board not found in this project");
  }

  await db.update(tasks).set({ taskBoardId }).where(eq(tasks.id, taskId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "task",
    subjectId: taskId,
    subjectName: task.title,
    metadata: { movedToTaskBoardId: taskBoardId },
  });

  revalidatePath(`/p/${projectSlug}/tasks`);
}

/* ─── list ──────────────────────────────────────── */

export interface TaskBoardRow {
  id: string;
  name: string;
  color: string | null;
  createdAt: Date;
  taskCount: number;
}

export async function listTaskBoardsForProject(
  projectId: string,
): Promise<TaskBoardRow[]> {
  const boards = await db.query.taskBoards.findMany({
    where: eq(taskBoards.projectId, projectId),
    orderBy: [asc(taskBoards.sortOrder), asc(taskBoards.name)],
    columns: {
      id: true,
      name: true,
      color: true,
      createdAt: true,
    },
  });

  if (boards.length === 0) return [];

  // Cheap per-board count. We could do a single GROUP BY query instead
  // but the board count is bounded (rarely > 10 per project) so this is
  // fine.
  const counts = await Promise.all(
    boards.map(async (board) => {
      const rows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.taskBoardId, board.id));
      return rows.length;
    }),
  );

  return boards.map((board, index) => ({
    ...board,
    taskCount: counts[index] ?? 0,
  }));
}
