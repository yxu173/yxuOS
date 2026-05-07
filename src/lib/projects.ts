"use server";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { projects } from "@/db/schema";

const DEFAULT_PROJECT_SLUG = "workspace";
const DEFAULT_PROJECT_NAME = "Workspace";

/**
 * Returns the first non-archived project for a team, creating the
 * default "Workspace" project lazily if the team has none. Used by every
 * code path that needs a project context but only has a team id —
 * pre-projects-rollout teams that haven't been backfilled, brand-new
 * teams created via `authClient.organization.create`, etc.
 */
export async function ensureDefaultProject(teamId: string): Promise<{
  id: string;
  slug: string;
  name: string;
}> {
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.teamId, teamId), eq(projects.archived, false)),
    orderBy: asc(projects.createdAt),
    columns: { id: true, slug: true, name: true },
  });
  if (existing) return existing;

  const id = nanoid();
  const now = new Date();
  try {
    await db.insert(projects).values({
      id,
      teamId,
      name: DEFAULT_PROJECT_NAME,
      slug: DEFAULT_PROJECT_SLUG,
      createdAt: now,
      updatedAt: now,
    });
    return { id, slug: DEFAULT_PROJECT_SLUG, name: DEFAULT_PROJECT_NAME };
  } catch {
    // A concurrent insert raced and won. Re-read and return.
    const racedRow = await db.query.projects.findFirst({
      where: and(
        eq(projects.teamId, teamId),
        eq(projects.slug, DEFAULT_PROJECT_SLUG),
      ),
      columns: { id: true, slug: true, name: true },
    });
    if (!racedRow) throw new Error("Failed to ensure default project");
    return racedRow;
  }
}

/**
 * Server action wrapper of {@link ensureDefaultProject} so client
 * components (the create-team dialog, namely) can drop a default
 * project right after `authClient.organization.create`.
 */
export async function ensureDefaultProjectForTeam(
  teamId: string,
): Promise<{ slug: string }> {
  const project = await ensureDefaultProject(teamId);
  return { slug: project.slug };
}
