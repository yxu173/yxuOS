"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { designs } from "@/db/schema";
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
 * Creates a new design canvas owned by the current user and redirects to it.
 */
export async function createDesign() {
  const session = await requireSession();

  const [design] = await db
    .insert(designs)
    .values({
      ownerId: session.user.id,
    })
    .returning({ id: designs.id });

  revalidatePath("/designs");
  redirect(`/designs/${design.id}`);
}

/**
 * Persists the latest design canvas snapshot. Called from the canvas client
 * on a debounced cadence (parallel to saveBoardSnapshot).
 */
export async function saveDesignSnapshot(
  designId: string,
  snapshot: Record<string, unknown>,
) {
  const session = await requireSession();

  const result = await db
    .update(designs)
    .set({
      snapshot,
      updatedAt: new Date(),
    })
    .where(and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)))
    .returning({ id: designs.id });

  if (result.length === 0) {
    throw new Error("Design not found");
  }
}

export async function renameDesign(designId: string, name: string) {
  const session = await requireSession();

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) {
    throw new Error("Design name cannot be empty");
  }

  await db
    .update(designs)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)));

  revalidatePath("/designs");
  revalidatePath(`/designs/${designId}`);
}

export async function deleteDesign(designId: string) {
  const session = await requireSession();

  await db
    .delete(designs)
    .where(and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)));

  revalidatePath("/designs");
}

export async function enableDesignShare(designId: string): Promise<string> {
  const session = await requireSession();

  const existing = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)),
    columns: { shareToken: true },
  });
  if (!existing) {
    throw new Error("Design not found");
  }
  if (existing.shareToken) return existing.shareToken;

  const token = nanoid(24);
  await db
    .update(designs)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)));

  revalidatePath(`/designs/${designId}`);
  return token;
}

export async function disableDesignShare(designId: string) {
  const session = await requireSession();

  await db
    .update(designs)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(eq(designs.id, designId), eq(designs.ownerId, session.user.id)));

  revalidatePath(`/designs/${designId}`);
}
