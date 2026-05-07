"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { designFolders, designs } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveProject } from "@/lib/permissions";

const MAX_NAME = 80;

async function getFolderInProject(folderId: string, projectId: string) {
  const folder = await db.query.designFolders.findFirst({
    where: and(
      eq(designFolders.id, folderId),
      eq(designFolders.projectId, projectId),
    ),
    columns: { id: true, name: true, parentFolderId: true, projectId: true },
  });
  if (!folder) throw new Error("Folder not found");
  return folder;
}

/* ─── create ────────────────────────────────────── */

export interface CreateDesignFolderInput {
  projectSlug: string;
  name: string;
  parentFolderId?: string | null;
  color?: string | null;
}

export async function createDesignFolder(
  input: CreateDesignFolderInput,
): Promise<{ id: string }> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(input.projectSlug);

  const trimmed = input.name.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Folder name is required");

  if (input.parentFolderId) {
    await getFolderInProject(input.parentFolderId, projectId);
  }

  const [created] = await db
    .insert(designFolders)
    .values({
      projectId,
      parentFolderId: input.parentFolderId ?? null,
      name: trimmed,
      color: input.color ?? null,
    })
    .returning({ id: designFolders.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "design",
    subjectId: created.id,
    subjectName: trimmed,
    metadata: { kind: "folder", parentFolderId: input.parentFolderId ?? null },
  });

  revalidatePath(`/p/${projectSlug}/designs`);
  return { id: created.id };
}

/* ─── rename ────────────────────────────────────── */

export async function renameDesignFolder(
  folderId: string,
  rawName: string,
): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);

  const folder = await db.query.designFolders.findFirst({
    where: eq(designFolders.id, folderId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!folder) throw new Error("Folder not found");
  if (folder.projectId !== projectId) {
    throw new Error("Folder belongs to a different project");
  }

  const trimmed = rawName.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Folder name is required");
  if (trimmed === folder.name) return;

  await db
    .update(designFolders)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(designFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "design",
    subjectId: folderId,
    subjectName: trimmed,
    metadata: { kind: "folder" },
  });

  revalidatePath(`/p/${projectSlug}/designs`);
}

/* ─── delete ────────────────────────────────────── */

export async function deleteDesignFolder(folderId: string): Promise<void> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(null);
  const folder = await db.query.designFolders.findFirst({
    where: eq(designFolders.id, folderId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!folder) throw new Error("Folder not found");
  if (folder.projectId !== projectId) {
    throw new Error("Folder belongs to a different project");
  }

  await db.delete(designFolders).where(eq(designFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "design",
    subjectId: folderId,
    subjectName: folder.name,
    metadata: { kind: "folder" },
  });

  revalidatePath(`/p/${projectSlug}/designs`);
}

/* ─── move folder ───────────────────────────────── */

export async function moveDesignFolder(
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
    const descendants = await collectDescendants(folderId, projectId);
    if (descendants.has(parentFolderId)) {
      throw new Error("Can't move a folder into one of its sub-folders");
    }
  }

  await db
    .update(designFolders)
    .set({ parentFolderId, updatedAt: new Date() })
    .where(eq(designFolders.id, folderId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "design",
    subjectId: folderId,
    subjectName: folder.name,
    metadata: { kind: "folder", movedTo: parentFolderId },
  });

  revalidatePath(`/p/${projectSlug}/designs`);
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
      .select({ id: designFolders.id })
      .from(designFolders)
      .where(
        and(
          eq(designFolders.projectId, projectId),
          eq(designFolders.parentFolderId, id),
        ),
      );
    for (const child of children) queue.push(child.id);
  }
  return out;
}

/* ─── move design ───────────────────────────────── */

export async function moveDesignToFolder(
  designId: string,
  folderId: string | null,
): Promise<void> {
  const { teamId, projectId, projectSlug, session } =
    await requireActiveProject(null);

  const design = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
    columns: { id: true, name: true, projectId: true },
  });
  if (!design) throw new Error("Design not found");
  if (design.projectId !== projectId) {
    throw new Error("Design belongs to a different project");
  }

  if (folderId) {
    await getFolderInProject(folderId, projectId);
  }

  await db
    .update(designs)
    .set({ folderId })
    .where(eq(designs.id, designId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "design",
    subjectId: designId,
    subjectName: design.name,
    metadata: { movedToFolderId: folderId },
  });

  revalidatePath(`/p/${projectSlug}/designs`);
}

/* ─── list ──────────────────────────────────────── */

export interface DesignFolderRow {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  sortOrder: number;
  createdAt: Date;
}

export async function listDesignFoldersForProject(
  projectId: string,
): Promise<DesignFolderRow[]> {
  return db.query.designFolders.findMany({
    where: eq(designFolders.projectId, projectId),
    orderBy: [asc(designFolders.sortOrder), asc(designFolders.name)],
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
