"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

/**
 * Creates a new board owned by the active team and redirects to it.
 * The current user is recorded as the creator (`ownerId`) for "Created
 * by Alice" badges; access control is by `teamId`.
 */
export async function createBoard() {
  const { session, teamId } = await requireActiveTeam();
  const project = await ensureDefaultProject(teamId);

  const [board] = await db
    .insert(boards)
    .values({
      ownerId: session.user.id,
      teamId,
      projectId: project.id,
    })
    .returning({ id: boards.id, name: boards.name });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "board",
    subjectId: board.id,
    subjectName: board.name,
  });

  revalidatePath("/boards");
  redirect(`/boards/${board.id}`);
}

/**
 * Persists the latest tldraw snapshot for a board. Any team member can
 * edit any team board.
 */
export async function saveBoardSnapshot(
  boardId: string,
  snapshot: Record<string, unknown>,
) {
  const { teamId } = await requireActiveTeam();

  const result = await db
    .update(boards)
    .set({
      snapshot,
      updatedAt: new Date(),
    })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)))
    .returning({ id: boards.id });

  if (result.length === 0) {
    throw new Error("Board not found");
  }
}

export async function renameBoard(boardId: string, name: string) {
  const { session, teamId } = await requireActiveTeam();

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) {
    throw new Error("Board name cannot be empty");
  }

  await db
    .update(boards)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "board",
    subjectId: boardId,
    subjectName: trimmed,
  });

  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteBoard(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  // Snapshot the name before deleting so the activity feed reads cleanly.
  const existing = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { name: true },
  });

  await db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  if (existing) {
    await logActivity({
      teamId,
      actorId: session.user.id,
      verb: "deleted",
      subjectType: "board",
      subjectId: boardId,
      subjectName: existing.name,
    });
  }

  revalidatePath("/boards");
}

export async function enableBoardShare(boardId: string): Promise<string> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { shareToken: true },
  });
  if (!existing) {
    throw new Error("Board not found");
  }
  if (existing.shareToken) return existing.shareToken;

  const token = nanoid(24);

  await db
    .update(boards)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  revalidatePath(`/boards/${boardId}`);
  return token;
}

export async function disableBoardShare(boardId: string) {
  const { teamId } = await requireActiveTeam();

  await db
    .update(boards)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  revalidatePath(`/boards/${boardId}`);
}
