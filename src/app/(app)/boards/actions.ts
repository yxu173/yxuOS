"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";

async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * Creates a new board owned by the current user and redirects to it.
 * Used as a `<form action>` on the boards index.
 */
export async function createBoard() {
  const session = await requireSession();

  const [board] = await db
    .insert(boards)
    .values({
      ownerId: session.user.id,
    })
    .returning({ id: boards.id });

  revalidatePath("/boards");
  redirect(`/boards/${board.id}`);
}

/**
 * Persists the latest tldraw snapshot for a board. Called from the canvas
 * client component on a debounced cadence.
 */
export async function saveBoardSnapshot(
  boardId: string,
  snapshot: Record<string, unknown>,
) {
  const session = await requireSession();

  const result = await db
    .update(boards)
    .set({
      snapshot,
      updatedAt: new Date(),
    })
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)))
    .returning({ id: boards.id });

  if (result.length === 0) {
    throw new Error("Board not found");
  }
}

/**
 * Renames a board. Used by the top bar / inline rename later.
 */
export async function renameBoard(boardId: string, name: string) {
  const session = await requireSession();

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) {
    throw new Error("Board name cannot be empty");
  }

  await db
    .update(boards)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)));

  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
}

/**
 * Deletes a board. Hard delete for now — restore-from-trash can come later.
 */
export async function deleteBoard(boardId: string) {
  const session = await requireSession();

  await db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)));

  revalidatePath("/boards");
}
