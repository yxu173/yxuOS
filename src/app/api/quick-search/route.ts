import { and, desc, eq, ilike } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  designs,
  projects,
  researchNotes,
  taskPlans,
  tasks,
} from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";

/**
 * Backing endpoint for the global Cmd+K launcher.
 *
 * Searches across every "navigable" entity on the active team in a
 * single request and returns a flat result set tagged with `kind`,
 * which the launcher uses to drive icons, sections, and routing.
 *
 * Kinds returned:
 *   - `task`     — top-level project task
 *   - `board`    — whiteboard
 *   - `design`   — design surface
 *   - `research` — research note
 *   - `plan`     — task plan
 *
 * Ranking strategy: items in the **active project** float to the top
 * (the launcher passes `projectSlug` for that). Within each kind,
 * results are ordered by `updatedAt desc`. With an empty query we
 * return the most recent items per kind so the launcher serves as a
 * "jump back" surface in addition to a search.
 *
 * Auth: must be a team member; results are scoped to the active team.
 */
export async function GET(req: Request) {
  let teamId: string;
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const projectSlug = url.searchParams.get("projectSlug");

  // Resolve preferred project (if the user is currently inside one).
  let preferredProjectId: string | null = null;
  if (projectSlug) {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.slug, projectSlug),
        eq(projects.teamId, teamId),
      ),
      columns: { id: true },
    });
    preferredProjectId = project?.id ?? null;
  }

  const PER_KIND = 8;

  // Each branch builds the same shape: pull rows, narrow if `q` is
  // present, order by `updatedAt desc`, project to the launcher item.
  // Five sequential queries stay well under 100ms on a warm cache.
  const taskWhere = q
    ? and(eq(tasks.teamId, teamId), ilike(tasks.title, `%${q}%`))
    : eq(tasks.teamId, teamId);
  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(taskWhere)
    .orderBy(desc(tasks.updatedAt))
    .limit(PER_KIND);

  const boardWhere = q
    ? and(eq(boards.teamId, teamId), ilike(boards.name, `%${q}%`))
    : eq(boards.teamId, teamId);
  const boardRows = await db
    .select({
      id: boards.id,
      title: boards.name,
      projectId: boards.projectId,
      updatedAt: boards.updatedAt,
    })
    .from(boards)
    .where(boardWhere)
    .orderBy(desc(boards.updatedAt))
    .limit(PER_KIND);

  const designWhere = q
    ? and(eq(designs.teamId, teamId), ilike(designs.name, `%${q}%`))
    : eq(designs.teamId, teamId);
  const designRows = await db
    .select({
      id: designs.id,
      title: designs.name,
      projectId: designs.projectId,
      updatedAt: designs.updatedAt,
    })
    .from(designs)
    .where(designWhere)
    .orderBy(desc(designs.updatedAt))
    .limit(PER_KIND);

  const researchWhere = q
    ? and(
        eq(researchNotes.teamId, teamId),
        ilike(researchNotes.title, `%${q}%`),
      )
    : eq(researchNotes.teamId, teamId);
  const researchRows = await db
    .select({
      id: researchNotes.id,
      title: researchNotes.title,
      projectId: researchNotes.projectId,
      updatedAt: researchNotes.updatedAt,
    })
    .from(researchNotes)
    .where(researchWhere)
    .orderBy(desc(researchNotes.updatedAt))
    .limit(PER_KIND);

  const planWhere = q
    ? and(eq(taskPlans.teamId, teamId), ilike(taskPlans.title, `%${q}%`))
    : eq(taskPlans.teamId, teamId);
  const planRows = await db
    .select({
      id: taskPlans.id,
      title: taskPlans.title,
      projectId: taskPlans.projectId,
      updatedAt: taskPlans.updatedAt,
    })
    .from(taskPlans)
    .where(planWhere)
    .orderBy(desc(taskPlans.updatedAt))
    .limit(PER_KIND);

  // Resolve project names + slugs in one batched call. The launcher
  // needs the slug to build hrefs (every kind lives under
  // `/p/<slug>/…`).
  const projectIds = uniq(
    [
      ...taskRows,
      ...boardRows,
      ...designRows,
      ...researchRows,
      ...planRows,
    ]
      .map((r) => r.projectId)
      .filter((v): v is string => Boolean(v)),
  );
  const projectInfo =
    projectIds.length > 0
      ? await db
          .select({
            id: projects.id,
            name: projects.name,
            slug: projects.slug,
          })
          .from(projects)
          .where(eq(projects.teamId, teamId))
      : [];
  const byProject = new Map(projectInfo.map((p) => [p.id, p]));

  const items: QuickSearchItem[] = [];
  for (const r of taskRows) {
    const project = r.projectId ? byProject.get(r.projectId) : null;
    if (!project) continue;
    items.push({
      kind: "task",
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: project.name,
      href: `/p/${project.slug}/tasks/${r.id}`,
      updatedAt: r.updatedAt,
    });
  }
  for (const r of boardRows) {
    const project = r.projectId ? byProject.get(r.projectId) : null;
    if (!project) continue;
    items.push({
      kind: "board",
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: project.name,
      href: `/p/${project.slug}/boards/${r.id}`,
      updatedAt: r.updatedAt,
    });
  }
  for (const r of designRows) {
    const project = r.projectId ? byProject.get(r.projectId) : null;
    if (!project) continue;
    items.push({
      kind: "design",
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: project.name,
      href: `/p/${project.slug}/designs/${r.id}`,
      updatedAt: r.updatedAt,
    });
  }
  for (const r of researchRows) {
    const project = byProject.get(r.projectId);
    if (!project) continue;
    items.push({
      kind: "research",
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: project.name,
      href: `/p/${project.slug}/research/${r.id}`,
      updatedAt: r.updatedAt,
    });
  }
  for (const r of planRows) {
    const project = byProject.get(r.projectId);
    if (!project) continue;
    items.push({
      kind: "plan",
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: project.name,
      href: `/p/${project.slug}/plans/${r.id}`,
      updatedAt: r.updatedAt,
    });
  }

  // Cross-kind ranking: preferred-project first, then most recent
  // overall. The launcher groups these into per-kind sections, but
  // the global order matters for the "jump to most recent thing"
  // case where the user has a tiny query and just wants to land
  // somewhere relevant.
  items.sort((a, b) => {
    if (preferredProjectId) {
      const aHit = a.projectId === preferredProjectId ? 0 : 1;
      const bHit = b.projectId === preferredProjectId ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  return Response.json({ items });
}

export interface QuickSearchItem {
  kind: "task" | "board" | "design" | "research" | "plan";
  id: string;
  title: string;
  projectId: string | null;
  projectName: string;
  href: string;
  updatedAt: Date;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
