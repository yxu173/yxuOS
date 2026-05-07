"use server";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { projects, taskBoards } from "@/db/schema";

const DEFAULT_PROJECT_SLUG = "workspace";
const DEFAULT_PROJECT_NAME = "Workspace";

const DEFAULT_TASK_BOARD_NAME = "All tasks";

/**
 * Returns the project's first task board, creating a default
 * "All tasks" board lazily if the project has none. Same idempotent
 * pattern as `ensureDefaultProject`.
 */
export async function ensureDefaultTaskBoard(
  projectId: string,
): Promise<{ id: string; name: string }> {
  const existing = await db.query.taskBoards.findFirst({
    where: eq(taskBoards.projectId, projectId),
    orderBy: asc(taskBoards.createdAt),
    columns: { id: true, name: true },
  });
  if (existing) return existing;

  const id = nanoid();
  const now = new Date();
  try {
    await db.insert(taskBoards).values({
      id,
      projectId,
      name: DEFAULT_TASK_BOARD_NAME,
      createdAt: now,
      updatedAt: now,
    });
    return { id, name: DEFAULT_TASK_BOARD_NAME };
  } catch {
    const racedRow = await db.query.taskBoards.findFirst({
      where: eq(taskBoards.projectId, projectId),
      orderBy: asc(taskBoards.createdAt),
      columns: { id: true, name: true },
    });
    if (!racedRow) throw new Error("Failed to ensure default task board");
    return racedRow;
  }
}

export interface ProjectListItem {
  id: string;
  slug: string;
  name: string;
  color: string | null;
}

/**
 * Lists every non-archived project on a team. Used by the AppTopBar's
 * project switcher and any other view that needs to render the team's
 * project menu.
 */
export async function listProjectsForTeam(
  teamId: string,
): Promise<ProjectListItem[]> {
  const rows = await db.query.projects.findMany({
    where: and(eq(projects.teamId, teamId), eq(projects.archived, false)),
    orderBy: asc(projects.name),
    columns: { id: true, slug: true, name: true, color: true },
  });
  return rows;
}

/* ─── create project (server action) ─────────────── */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { logActivity } from "./activity";
import { requireActiveTeam } from "./permissions";
import { PROJECT_SLUG_RE, toProjectSlug } from "./slug";

const RESERVED_SLUGS = new Set([
  "settings",
  "new",
  "create",
  "archived",
  "p", // belt-and-braces — dropdowns shouldn't ever produce this
]);

export interface CreateProjectInput {
  name: string;
  slug?: string;
  color?: string | null;
}

/**
 * Creates a project on the active team and redirects the caller to its
 * boards index. Slugs auto-derive from the name and are unique per
 * team; reserved slugs throw.
 */
export async function createProject(
  input: CreateProjectInput,
): Promise<void> {
  const { session, teamId } = await requireActiveTeam("admin");

  const trimmedName = input.name.trim().slice(0, 80);
  if (!trimmedName) throw new Error("Project name is required");

  const candidateSlug = input.slug
    ? toProjectSlug(input.slug)
    : toProjectSlug(trimmedName);
  if (!candidateSlug) {
    throw new Error("Pick a slug with at least one letter or number");
  }
  if (!PROJECT_SLUG_RE.test(candidateSlug)) {
    throw new Error(
      "Slug must use lowercase letters, digits, and hyphens (no leading / trailing dash)",
    );
  }
  if (RESERVED_SLUGS.has(candidateSlug)) {
    throw new Error(`"${candidateSlug}" is reserved — pick another slug`);
  }

  const conflict = await db.query.projects.findFirst({
    where: and(
      eq(projects.teamId, teamId),
      eq(projects.slug, candidateSlug),
    ),
    columns: { id: true },
  });
  if (conflict) {
    throw new Error(`Slug "${candidateSlug}" is already used in this team`);
  }

  const id = nanoid();
  const now = new Date();
  await db.insert(projects).values({
    id,
    teamId,
    name: trimmedName,
    slug: candidateSlug,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Drop a default task board immediately so the tasks page renders
  // cleanly (no "no boards yet" fallback) the moment the user lands.
  await ensureDefaultTaskBoard(id);

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "project",
    subjectId: id,
    subjectName: trimmedName,
  });

  revalidatePath(`/p/${candidateSlug}`);
  redirect(`/p/${candidateSlug}/boards`);
}

/* ─── rename / archive / delete project ─────────── */

const MAX_NAME = 80;

export async function renameProject(
  projectIdToRename: string,
  rawName: string,
): Promise<void> {
  const { session, teamId } = await requireActiveTeam("admin");

  const trimmed = rawName.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Project name is required");

  const target = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectIdToRename),
      eq(projects.teamId, teamId),
    ),
    columns: { id: true, slug: true },
  });
  if (!target) throw new Error("Project not found");

  await db
    .update(projects)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(projects.id, projectIdToRename));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "project",
    subjectId: projectIdToRename,
    subjectName: trimmed,
  });

  revalidatePath(`/p/${target.slug}`);
}

export async function archiveProject(
  projectIdToArchive: string,
): Promise<void> {
  const { session, teamId } = await requireActiveTeam("admin");

  const target = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectIdToArchive),
      eq(projects.teamId, teamId),
    ),
    columns: { id: true, slug: true, name: true },
  });
  if (!target) throw new Error("Project not found");

  // Refuse to archive the last project on the team — UX would be a dead
  // end (every page that requires an active project would 404).
  const remaining = await db.query.projects.findMany({
    where: and(eq(projects.teamId, teamId), eq(projects.archived, false)),
    columns: { id: true },
  });
  if (remaining.length <= 1) {
    throw new Error(
      "Can't archive the team's only active project — create another one first.",
    );
  }

  await db
    .update(projects)
    .set({ archived: true, archivedAt: new Date() })
    .where(eq(projects.id, projectIdToArchive));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "project",
    subjectId: projectIdToArchive,
    subjectName: target.name,
  });

  revalidatePath(`/p/${target.slug}`);
  revalidatePath("/");
}

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
    // New projects always come with a default task board so the tasks
    // page is never empty-of-boards.
    await ensureDefaultTaskBoard(id);
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
