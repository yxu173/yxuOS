"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { boardFolders, boards } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveProject } from "@/lib/permissions";

const MAX_NAME = 80;

/* ─── helpers ───────────────────────────────────── */

async function getFolderInProject(folderId: string, projectId: string) {
  const folder = await db.query.boardFolders.findFirst({
    where: and(
      eq(boardFolders.id, folderId),
      eq(boardFolders.projectId, projectId),
    ),
    columns: {
      id: true,
      name: true,
      parentFolderId: true,
      projectId: true,
    },
  });
  if (!folder) throw new Error("Folder not found");
  return folder;
}

/* ─── create ────────────────────────────────────── */

export interface CreateBoardFolderInput {
  projectSlug: string;
  name: string;
  parentFolderId?: string | null;
  color?: string | null;
}

export async function createBoardFolder(
  input: CreateBoardFolderInput,
): Promise<{ id: string }> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(input.projectSlug);

  const trimmed = input.name.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Folder name is required");

  // Verify parent (if any) lives in the same project.
  if (input.parentFolderId) {
    await getFolderInProject(input.parentFolderId, projectId);
  }

  const [created] = await db
    .insert(boardFolders)
    .values({
      projectId,
      parentFolderId: input.parentFolderId ?? null,
      name: trimmed,
      color: input.color ?? null,
    })
    .returning({ id: boardFolders.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "board",
    subjectId: created.id,
    subjectName: trimmed,
    metadata: { kind: "folder", parentFolderId: input.parentFolderId ?? null },
  });

  revalidatePath(`/p/${projectSlug}/boards`);
  return { id: created.id };
}

/* ─── rename ────────────────────────────────────── */

export async function renameBoardFolder(
  folderId: string,
  rawName: string,
): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);
  // Resolve the folder's project explicitly so we can scope the rename
  // even when the caller didn't pass a slug.
  const folder = await db.query.boardFolders.findFirst({
    where: eq(boardFolders.id, folderId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!folder) throw new Error("Folder not found");
  if (folder.projectId !== projectId) {
    // The active team has access — but the folder is in a different
    // project. Re-resolve via that project's slug for the path-revalidate.
    // For safety, just refuse and ask the caller to navigate to that project.
    throw new Error("Folder belongs to a different project");
  }

  const trimmed = rawName.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Folder name is required");
  if (trimmed === folder.name) return;

  await db
    .update(boardFolders)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(boardFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "board",
    subjectId: folderId,
    subjectName: trimmed,
    metadata: { kind: "folder" },
  });

  revalidatePath(`/p/${projectSlug}/boards`);
}

/* ─── delete ────────────────────────────────────── */

export async function deleteBoardFolder(folderId: string): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);
  const folder = await db.query.boardFolders.findFirst({
    where: eq(boardFolders.id, folderId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!folder) throw new Error("Folder not found");
  if (folder.projectId !== projectId) {
    throw new Error("Folder belongs to a different project");
  }

  // The cascade on parent_folder_id removes nested folders; the
  // boards.folder_id `on delete set null` keeps the boards alive in the
  // project root.
  await db.delete(boardFolders).where(eq(boardFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "board",
    subjectId: folderId,
    subjectName: folder.name,
    metadata: { kind: "folder" },
  });

  revalidatePath(`/p/${projectSlug}/boards`);
}

/* ─── move folder (re-parent) ───────────────────── */

export async function moveBoardFolder(
  folderId: string,
  parentFolderId: string | null,
): Promise<void> {
  const { teamId, projectId, projectSlug, session } =
    await requireActiveProject(null);
  const folder = await getFolderInProject(folderId, projectId);

  if (parentFolderId === folderId) {
    throw new Error("A folder can't be its own parent");
  }

  if (parentFolderId) {
    await getFolderInProject(parentFolderId, projectId);
    // Block cycles: the proposed parent can't be a descendant of the
    // folder being moved.
    const descendants = await collectDescendants(folderId, projectId);
    if (descendants.has(parentFolderId)) {
      throw new Error("Can't move a folder into one of its sub-folders");
    }
  }

  await db
    .update(boardFolders)
    .set({ parentFolderId, updatedAt: new Date() })
    .where(eq(boardFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "board",
    subjectId: folderId,
    subjectName: folder.name,
    metadata: { kind: "folder", movedTo: parentFolderId },
  });

  revalidatePath(`/p/${projectSlug}/boards`);
}

async function collectDescendants(
  rootId: string,
  projectId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    const children = await db
      .select({ id: boardFolders.id })
      .from(boardFolders)
      .where(
        and(
          eq(boardFolders.projectId, projectId),
          eq(boardFolders.parentFolderId, id),
        ),
      );
    for (const child of children) queue.push(child.id);
  }
  return out;
}

/* ─── move board ────────────────────────────────── */

export async function moveBoardToFolder(
  boardId: string,
  folderId: string | null,
): Promise<void> {
  const { teamId, projectId, projectSlug, session } =
    await requireActiveProject(null);

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true, name: true, projectId: true },
  });
  if (!board) throw new Error("Board not found");
  if (board.projectId !== projectId) {
    throw new Error("Board belongs to a different project");
  }

  if (folderId) {
    await getFolderInProject(folderId, projectId);
  }

  await db.update(boards).set({ folderId }).where(eq(boards.id, boardId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "board",
    subjectId: boardId,
    subjectName: board.name,
    metadata: { movedToFolderId: folderId },
  });

  revalidatePath(`/p/${projectSlug}/boards`);
}

/* ─── list (server-side helpers) ────────────────── */

export interface BoardFolderRow {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  sortOrder: number;
  createdAt: Date;
}

export async function listBoardFoldersForProject(
  projectId: string,
): Promise<BoardFolderRow[]> {
  return db.query.boardFolders.findMany({
    where: eq(boardFolders.projectId, projectId),
    orderBy: [asc(boardFolders.sortOrder), asc(boardFolders.name)],
    columns: {
      id: true,
      name: true,
      color: true,
      parentFolderId: true,
      sortOrder: true,
      createdAt: true,
    },
  });
}
