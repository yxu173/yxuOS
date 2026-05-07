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

/**
 * Slug-keyed counterpart to updateDesignComponentTree, used by the
 * design agent's `update_component` tool. Looks up the component by
 * (teamId, slug), confirms it exists inside the active team, and
 * applies the new tree (and optionally a new display name) in one
 * round-trip. Returns the component's id so the caller can correlate.
 *
 * Slug uniqueness is per-creator (legacy), but every component still
 * belongs to a single team — querying by (teamId, slug) is safe
 * because the agent only ever resolves slugs returned from the same
 * team's `list_components`.
 */
export async function updateDesignComponentBySlug(input: {
  slug: string;
  tree: Record<string, unknown>;
  name?: string;
}): Promise<{ id: string; slug: string }> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.designComponents.findFirst({
    where: and(
      eq(designComponents.teamId, teamId),
      eq(designComponents.slug, input.slug),
    ),
    columns: { id: true, slug: true },
  });
  if (!existing) {
    throw new Error(`Component "${input.slug}" not found in this team`);
  }

  const patch: { tree: Record<string, unknown>; updatedAt: Date; name?: string } = {
    tree: input.tree,
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Component name cannot be empty");
    patch.name = trimmed;
  }

  await db
    .update(designComponents)
    .set(patch)
    .where(eq(designComponents.id, existing.id));

  revalidatePath("/designs");
  return { id: existing.id, slug: existing.slug };
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
 * Fetch every component visible from a given (team, project) context.
 * - If `projectId` is supplied, only that project's components are
 *   returned — this is what the design page uses now that components are
 *   project-scoped.
 * - If only `teamId` is supplied (e.g. legacy callers), every component
 *   on the team is returned. This path is kept for the public share
 *   page until that page also threads a projectId through.
 */
export async function listDesignComponentsForTeam(
  teamId: string,
  projectId?: string,
) {
  return db.query.designComponents.findMany({
    where: projectId
      ? and(
          eq(designComponents.teamId, teamId),
          eq(designComponents.projectId, projectId),
        )
      : eq(designComponents.teamId, teamId),
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
