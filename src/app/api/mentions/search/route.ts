import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boardFolders,
  boards,
  designs,
  projects,
  researchNotes,
  taskPlans,
} from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";

/**
 * Unified search endpoint for the `@`-mention popover.
 *
 * Returns one flat list of items, each tagged with `kind` so the
 * client can group them visually. Three kinds are supported:
 *   - `board`    — a board snapshot
 *   - `research` — a research note
 *   - `plan`     — a task plan
 *
 * Ranking strategy: items in the **preferred project** float above
 * items in other projects of the same team. Within each project,
 * results are sorted by `updatedAt desc`.
 *
 * Query params:
 *   - `q`           — substring match across all three name columns.
 *   - `designId`    — boost the design's project to the top.
 *   - `projectId`   — boost a specific project.
 *   - `projectSlug` — same as `projectId` but resolved via slug.
 *   - `kinds`       — comma-separated subset of {board, research, plan}.
 *                     If absent, all three are searched.
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
  const designId = url.searchParams.get("designId");
  const projectIdParam = url.searchParams.get("projectId");
  const projectSlug = url.searchParams.get("projectSlug");
  const kindsParam = (url.searchParams.get("kinds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is "board" | "research" | "plan" =>
      s === "board" || s === "research" || s === "plan",
    );
  const enabled = new Set<"board" | "research" | "plan">(
    kindsParam.length > 0
      ? kindsParam
      : ["board", "research", "plan"],
  );

  // Resolve a preferred project to boost. First-hit wins, in priority
  // order. Each lookup is team-scoped to keep stale ids from leaking.
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

  // We pull a generous per-kind cap and then do final ranking + slice
  // in JS. That keeps the SQL simple at the cost of a little memory
  // (each row is ~150 bytes).
  const PER_KIND_LIMIT = 20;
  const FINAL_LIMIT = 25;

  // ── Boards ──────────────────────────────────────────────────────
  let boardItems: MentionRow[] = [];
  if (enabled.has("board")) {
    const where = q
      ? and(eq(boards.teamId, teamId), ilike(boards.name, `%${q}%`))
      : eq(boards.teamId, teamId);
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
      .limit(PER_KIND_LIMIT);
    boardItems = rows.map((r) => ({
      id: r.id,
      kind: "board" as const,
      name: r.name,
      projectId: r.projectId ?? null,
      folderId: r.folderId ?? null,
      updatedAt: r.updatedAt,
      isEmpty: !r.hasSnapshot,
    }));
  }

  // ── Research notes ──────────────────────────────────────────────
  let researchItems: MentionRow[] = [];
  if (enabled.has("research")) {
    // We search the title only — a body-text search would add little
    // signal but a lot of noise (notes are long, mostly Markdown).
    const where = q
      ? and(
          eq(researchNotes.teamId, teamId),
          ilike(researchNotes.title, `%${q}%`),
        )
      : eq(researchNotes.teamId, teamId);
    const rows = await db
      .select({
        id: researchNotes.id,
        name: researchNotes.title,
        projectId: researchNotes.projectId,
        updatedAt: researchNotes.updatedAt,
      })
      .from(researchNotes)
      .where(where)
      .orderBy(desc(researchNotes.updatedAt))
      .limit(PER_KIND_LIMIT);
    researchItems = rows.map((r) => ({
      id: r.id,
      kind: "research" as const,
      name: r.name,
      projectId: r.projectId,
      folderId: null,
      updatedAt: r.updatedAt,
      isEmpty: false,
    }));
  }

  // ── Plans ───────────────────────────────────────────────────────
  let planItems: MentionRow[] = [];
  if (enabled.has("plan")) {
    // Skip archived plans — mentioning an archive in fresh chat is
    // rarely intentional and they crowd the popover.
    const where = q
      ? and(
          eq(taskPlans.teamId, teamId),
          ilike(taskPlans.title, `%${q}%`),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sql`${taskPlans.status} != 'archived'` as any),
        )
      : and(
          eq(taskPlans.teamId, teamId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sql`${taskPlans.status} != 'archived'` as any),
        );
    const rows = await db
      .select({
        id: taskPlans.id,
        name: taskPlans.title,
        projectId: taskPlans.projectId,
        updatedAt: taskPlans.updatedAt,
        status: taskPlans.status,
      })
      .from(taskPlans)
      .where(where)
      .orderBy(desc(taskPlans.updatedAt))
      .limit(PER_KIND_LIMIT);
    planItems = rows.map((r) => ({
      id: r.id,
      kind: "plan" as const,
      name: r.name,
      projectId: r.projectId,
      folderId: null,
      updatedAt: r.updatedAt,
      // Re-use `isEmpty` to flag executed/draft plans visually in
      // the popover. Slight semantic stretch; keeps the row shape flat.
      isEmpty: r.status === "executed",
    }));
  }

  // Look up project + folder names in one batched call so we don't
  // fan out queries per item.
  const projectIds = uniq(
    [...boardItems, ...researchItems, ...planItems]
      .map((r) => r.projectId)
      .filter((v): v is string => Boolean(v)),
  );
  const folderIds = uniq(
    boardItems
      .map((r) => r.folderId)
      .filter((v): v is string => Boolean(v)),
  );

  const projectRows =
    projectIds.length > 0
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.teamId, teamId))
      : [];
  const folderRows =
    folderIds.length > 0
      ? await db
          .select({ id: boardFolders.id, name: boardFolders.name })
          .from(boardFolders)
          .where(or(...folderIds.map((id) => eq(boardFolders.id, id))))
      : [];

  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const folderName = new Map(folderRows.map((f) => [f.id, f.name]));

  // Final ranking: preferred-project items first (any kind), then the
  // rest, ordered by recency. Ties stay deterministic via id.
  const all = [...boardItems, ...researchItems, ...planItems].map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    projectId: r.projectId,
    projectName: r.projectId ? (projectName.get(r.projectId) ?? null) : null,
    folderName: r.folderId ? (folderName.get(r.folderId) ?? null) : null,
    isEmpty: r.isEmpty,
    updatedAt: r.updatedAt,
  }));

  all.sort((a, b) => {
    if (preferredProjectId) {
      const aHit = a.projectId === preferredProjectId ? 0 : 1;
      const bHit = b.projectId === preferredProjectId ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  return Response.json({ items: all.slice(0, FINAL_LIMIT) });
}

interface MentionRow {
  id: string;
  kind: "board" | "research" | "plan";
  name: string;
  projectId: string | null;
  folderId: string | null;
  updatedAt: Date;
  isEmpty: boolean;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
