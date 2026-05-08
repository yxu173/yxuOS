import { and, desc, eq, ilike, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { boardFolders, boards, designs, projects } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";

/**
 * Search boards in the active team for the design-chat `@mention`
 * picker.
 *
 * Ranking: boards in the design's project first (closest, most
 * relevant), then everything else, with `updatedAt desc` as the
 * stable tiebreaker. Empty boards (`snapshot IS NULL`) are kept in
 * the result so the user can still mention them — but the digest
 * the agent receives will say "(empty board)" so we don't surprise
 * the model with phantom content.
 *
 * Query params:
 *  - `q`           — case-insensitive substring match on board name.
 *                    Empty / missing → returns the most recent boards.
 *  - `designId`    — if provided, the design's project rises to the top.
 *  - `projectId`   — if provided, that project rises to the top.
 *  - `projectSlug` — same as `projectId` but resolved by slug. Cheaper
 *                    for tasks pages where we only have the slug from
 *                    the URL.
 *
 * Boost params are mutually compatible: the first one that resolves to
 * a project on this team wins. Useful for sharing the endpoint between
 * the design-chat composer and the task description editor.
 *
 * Auth: must be a member of the team via `requireActiveTeam`. We
 * never return boards from other teams.
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
  const designId = url.searchParams.get("designId");
  const projectIdParam = url.searchParams.get("projectId");
  const projectSlug = url.searchParams.get("projectSlug");

  // Resolve a preferred project to boost. Caller can hand us any of
  // {designId, projectId, projectSlug} — we resolve in that priority
  // order and stop at the first hit. Each lookup is scoped to the
  // active team so a stale id from another team can't leak through.
  let preferredProjectId: string | null = null;
  if (designId) {
    const design = await db.query.designs.findFirst({
      where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
      columns: { projectId: true },
    });
    preferredProjectId = design?.projectId ?? null;
  }
  if (!preferredProjectId && projectIdParam) {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, projectIdParam),
        eq(projects.teamId, teamId),
      ),
      columns: { id: true },
    });
    preferredProjectId = project?.id ?? null;
  }
  if (!preferredProjectId && projectSlug) {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.slug, projectSlug),
        eq(projects.teamId, teamId),
      ),
      columns: { id: true },
    });
    preferredProjectId = project?.id ?? null;
  }

  // Build the where clause incrementally so empty `q` works without a
  // useless wildcard (Postgres `ilike '%%'` is fine but a plain
  // `eq(teamId)` plan is cleaner).
  const where = q
    ? and(eq(boards.teamId, teamId), ilike(boards.name, `%${q}%`))
    : eq(boards.teamId, teamId);

  // Project + folder names join in a separate lookup pass — keeping
  // them out of the boards query lets Drizzle generate a tight
  // index scan on `boards_team_idx`.
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      projectId: boards.projectId,
      folderId: boards.folderId,
      updatedAt: boards.updatedAt,
      hasSnapshot: isNotNull(boards.snapshot),
    })
    .from(boards)
    .where(where)
    .orderBy(desc(boards.updatedAt))
    .limit(50);

  if (rows.length === 0) {
    return Response.json({ boards: [] });
  }

  const projectIds = uniq(
    rows.map((r) => r.projectId).filter((v): v is string => Boolean(v)),
  );
  const folderIds = uniq(
    rows.map((r) => r.folderId).filter((v): v is string => Boolean(v)),
  );

  const projectRows =
    projectIds.length > 0
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(eq(projects.teamId, teamId)))
      : [];
  const folderRows =
    folderIds.length > 0
      ? await db
          .select({ id: boardFolders.id, name: boardFolders.name })
          .from(boardFolders)
      : [];

  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const folderName = new Map(folderRows.map((f) => [f.id, f.name]));

  const enriched = rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectId: r.projectId,
    projectName: r.projectId ? (projectName.get(r.projectId) ?? null) : null,
    folderName: r.folderId ? (folderName.get(r.folderId) ?? null) : null,
    updatedAt: r.updatedAt,
    isEmpty: !r.hasSnapshot,
  }));

  // Boost preferred project to the top — same project as the active
  // design is the user's most likely intent.
  if (preferredProjectId) {
    enriched.sort((a, b) => {
      const aHit = a.projectId === preferredProjectId ? 0 : 1;
      const bHit = b.projectId === preferredProjectId ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
      // Stable secondary sort by updatedAt desc (already roughly
      // ordered, but re-confirm to keep the boost deterministic).
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  return Response.json({ boards: enriched.slice(0, 20) });
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
