"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { designs } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";

export async function createDesign() {
  const { session, teamId } = await requireActiveTeam();

  const [design] = await db
    .insert(designs)
    .values({
      ownerId: session.user.id,
      teamId,
    })
    .returning({ id: designs.id });

  revalidatePath("/designs");
  redirect(`/designs/${design.id}`);
}

export async function saveDesignSnapshot(
  designId: string,
  snapshot: Record<string, unknown>,
) {
  const { teamId } = await requireActiveTeam();

  const result = await db
    .update(designs)
    .set({
      snapshot,
      updatedAt: new Date(),
    })
    .where(and(eq(designs.id, designId), eq(designs.teamId, teamId)))
    .returning({ id: designs.id });

  if (result.length === 0) {
    throw new Error("Design not found");
  }
}

export async function renameDesign(designId: string, name: string) {
  const { teamId } = await requireActiveTeam();

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) {
    throw new Error("Design name cannot be empty");
  }

  await db
    .update(designs)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(designs.id, designId), eq(designs.teamId, teamId)));

  revalidatePath("/designs");
  revalidatePath(`/designs/${designId}`);
}

export async function deleteDesign(designId: string) {
  const { teamId } = await requireActiveTeam();

  await db
    .delete(designs)
    .where(and(eq(designs.id, designId), eq(designs.teamId, teamId)));

  revalidatePath("/designs");
}

export async function enableDesignShare(designId: string): Promise<string> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
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
    .where(and(eq(designs.id, designId), eq(designs.teamId, teamId)));

  revalidatePath(`/designs/${designId}`);
  return token;
}

export async function disableDesignShare(designId: string) {
  const { teamId } = await requireActiveTeam();

  await db
    .update(designs)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(eq(designs.id, designId), eq(designs.teamId, teamId)));

  revalidatePath(`/designs/${designId}`);
}
