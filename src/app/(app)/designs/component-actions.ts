"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { designComponents } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

/* ─── slug helpers ───────────────────────────────────── */

const SLUG_BASE_LIMIT = 60;

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_LIMIT);
}

async function uniqueSlugFor(
  ownerId: string,
  base: string,
  ignoreId?: string,
): Promise<string> {
  const slug = base || "component";
  let suffix = 0;
  while (true) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const collision = await db.query.designComponents.findFirst({
      where: and(
        eq(designComponents.ownerId, ownerId),
        eq(designComponents.slug, candidate),
      ),
      columns: { id: true },
    });
    if (!collision || (ignoreId && collision.id === ignoreId)) {
      return candidate;
    }
    suffix += 1;
    if (suffix > 100) throw new Error("Could not allocate unique slug");
  }
}

/* ─── actions ───────────────────────────────────────── */

export async function createDesignComponent(input: {
  name: string;
  slug?: string;
  tree: Record<string, unknown>;
}): Promise<{ id: string; slug: string }> {
  const { session, teamId } = await requireActiveTeam();
  const project = await ensureDefaultProject(teamId);

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Component name cannot be empty");
  }

  const baseSlug = input.slug ? toSlug(input.slug) : toSlug(trimmedName);
  // Slugs are unique per-creator (legacy constraint). Until we drop the
  // owner_id unique index in a future migration, allocate against the
  // creator's namespace.
  const slug = await uniqueSlugFor(session.user.id, baseSlug);

  const [created] = await db
    .insert(designComponents)
    .values({
      ownerId: session.user.id,
      teamId,
      projectId: project.id,
      name: trimmedName,
      slug,
      tree: input.tree,
    })
    .returning({ id: designComponents.id, slug: designComponents.slug });

  revalidatePath("/designs");
  return { id: created.id, slug: created.slug };
}

export async function renameDesignComponent(
  componentId: string,
  name: string,
) {
  const { teamId } = await requireActiveTeam();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Component name cannot be empty");

  await db
    .update(designComponents)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(
      and(
        eq(designComponents.id, componentId),
        eq(designComponents.teamId, teamId),
      ),
    );

  revalidatePath("/designs");
}

export async function updateDesignComponentTree(
  componentId: string,
  tree: Record<string, unknown>,
) {
  const { teamId } = await requireActiveTeam();
  await db
    .update(designComponents)
    .set({ tree, updatedAt: new Date() })
    .where(
      and(
        eq(designComponents.id, componentId),
        eq(designComponents.teamId, teamId),
      ),
    );

  revalidatePath("/designs");
}

export async function deleteDesignComponent(componentId: string) {
  const { teamId } = await requireActiveTeam();
  await db
    .delete(designComponents)
    .where(
      and(
        eq(designComponents.id, componentId),
        eq(designComponents.teamId, teamId),
      ),
    );

  revalidatePath("/designs");
}

/**
 * Fetch every component for `teamId`. Used by both the design page (the
 * active team's library) and the public share page (the design's team
 * library, so component-refs in shared designs still expand).
 */
export async function listDesignComponentsForTeam(teamId: string) {
  return db.query.designComponents.findMany({
    where: eq(designComponents.teamId, teamId),
    orderBy: asc(designComponents.name),
    columns: {
      id: true,
      name: true,
      slug: true,
      tree: true,
      updatedAt: true,
    },
  });
}
