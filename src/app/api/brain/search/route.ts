import { eq } from "drizzle-orm";

import { db } from "@/db";
import { projects } from "@/db/schema";
import { type KnowledgeKind } from "@/db/schema/project-knowledge";
import { requireActiveTeam } from "@/lib/permissions";
import { isEmbeddingsEnabled } from "@/lib/rag/embed";
import {
  hrefForHit,
  type KnowledgeHit,
  searchProjectKnowledge,
} from "@/lib/rag/retrieve";

/**
 * Backing endpoint for the **project brain** UI (search box on
 * `/p/<slug>/brain`).
 *
 * Always project-scoped: the caller passes a `projectSlug` and we
 * resolve it to a `projectId` server-side after verifying the
 * caller's team owns it. Same shape as `/api/quick-search` for
 * consistency, but the ranking is semantic (cosine similarity
 * over chunk embeddings) instead of text-LIKE.
 *
 * Empty query path: returns the most recently indexed chunks,
 * lightly de-duplicated per artifact so a single research note
 * doesn't dominate the landing state. Useful as a "show me
 * what's in here" affordance when the user just opens the page.
 *
 * Response shape is what the brain page renders; if you change
 * fields keep `BrainSearchItem` in sync with the client (defined
 * in `src/components/brain/brain-search.tsx`).
 */
export interface BrainSearchItem {
  /** Stable id for React keys. */
  id: string;
  sourceType: KnowledgeKind;
  sourceId: string;
  title: string | null;
  anchor: string | null;
  /** Plain-text excerpt, capped on the server. */
  excerpt: string;
  /** Cosine similarity in [0, 1]. `null` for the "empty query" listing. */
  similarity: number | null;
  /** Canonical link to the source artifact. `null` for kinds without one (comments). */
  href: string | null;
  updatedAt: string;
}

export interface BrainSearchResponse {
  items: BrainSearchItem[];
  /** True when neither Azure nor OpenAI embeddings are configured. */
  embeddingsDisabled: boolean;
  /** Whether this response is a recency listing (empty query). */
  empty: boolean;
}

/** Hard cap on excerpt length — keeps responses sub-100 KB even at k=50. */
const EXCERPT_CAP = 320;

export async function GET(req: Request) {
  let teamId: string;
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const projectSlug = url.searchParams.get("projectSlug");
  if (!projectSlug) {
    return new Response("projectSlug is required", { status: 400 });
  }

  // Resolve project + verify ownership in a single round trip.
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true, slug: true, teamId: true },
  });
  if (!project || project.teamId !== teamId) {
    // 404 not 403 — don't leak existence across teams.
    return new Response("Not found", { status: 404 });
  }

  const q = (url.searchParams.get("q") ?? "").trim();
  const kParam = Number(url.searchParams.get("k") ?? "20");
  const k = Math.max(1, Math.min(50, Number.isFinite(kParam) ? kParam : 20));
  const kindsParam = url.searchParams.get("kinds");
  const kinds = parseKinds(kindsParam);

  if (!isEmbeddingsEnabled()) {
    return Response.json({
      items: [],
      embeddingsDisabled: true,
      empty: q.length === 0,
    } satisfies BrainSearchResponse);
  }

  // Empty query → most recent chunks in the project, per kind. The
  // brain UI renders this as the landing state so the page isn't
  // empty before the user types.
  if (q.length === 0) {
    const items = await fetchRecentChunks({ projectId: project.id, k, kinds });
    return Response.json({
      items: items.map((row) => formatItem(row, project.slug, null)),
      embeddingsDisabled: false,
      empty: true,
    } satisfies BrainSearchResponse);
  }

  const hits = await searchProjectKnowledge({
    projectId: project.id,
    query: q,
    k,
    kinds,
    // UI lets the user see weak hits too — the agent tool tightens
    // this internally; the human-facing page is more forgiving.
    minSimilarity: 0.15,
  });

  return Response.json({
    items: hits.map((hit) => formatItem(hit, project.slug, hit.similarity)),
    embeddingsDisabled: false,
    empty: false,
  } satisfies BrainSearchResponse);
}

/* ─── helpers ─────────────────────────────────────── */

const ALL_KINDS: readonly KnowledgeKind[] = [
  "research_note",
  "task_plan",
  "task_plan_row",
  "task",
  "board",
  "design",
  "design_chat",
  "comment",
];

function parseKinds(raw: string | null): KnowledgeKind[] | undefined {
  if (!raw) return undefined;
  const set = new Set(ALL_KINDS);
  const out: KnowledgeKind[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (set.has(trimmed as KnowledgeKind)) {
      out.push(trimmed as KnowledgeKind);
    }
  }
  return out.length > 0 ? out : undefined;
}

function formatItem(
  hit: KnowledgeHit,
  projectSlug: string,
  similarity: number | null,
): BrainSearchItem {
  return {
    id: hit.id,
    sourceType: hit.sourceType,
    sourceId: hit.sourceId,
    title: hit.title,
    anchor: hit.anchor,
    excerpt: clip(hit.content, EXCERPT_CAP),
    similarity,
    href: hrefForHit(hit, { slug: projectSlug }),
    updatedAt:
      typeof hit.updatedAt === "string"
        ? hit.updatedAt
        : hit.updatedAt.toISOString(),
  };
}

function clip(input: string, max: number): string {
  const flat = input.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Fetch the most-recent chunks in the project for the landing state.
 * Capped per-artifact via `DISTINCT ON` so one giant note doesn't
 * fill the page.
 */
async function fetchRecentChunks({
  projectId,
  k,
  kinds,
}: {
  projectId: string;
  k: number;
  kinds: KnowledgeKind[] | undefined;
}): Promise<KnowledgeHit[]> {
  // We use the drizzle query layer for the simple no-vector case.
  // The `projectKnowledge` rows are already indexed for this; we
  // dedupe to one chunk per `(source_type, source_id)` so a long
  // doc shows up once in the landing list.
  const { projectKnowledge } = await import("@/db/schema/project-knowledge");
  const { desc, inArray } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: projectKnowledge.id,
      sourceType: projectKnowledge.sourceType,
      sourceId: projectKnowledge.sourceId,
      chunkIndex: projectKnowledge.chunkIndex,
      title: projectKnowledge.title,
      anchor: projectKnowledge.anchor,
      content: projectKnowledge.content,
      updatedAt: projectKnowledge.updatedAt,
      metadata: projectKnowledge.metadata,
    })
    .from(projectKnowledge)
    .where(
      kinds
        ? inArray(projectKnowledge.sourceType, kinds)
        : eq(projectKnowledge.projectId, projectId),
    )
    .orderBy(desc(projectKnowledge.updatedAt))
    // Over-fetch so we can dedupe per artifact without missing the
    // requested k.
    .limit(k * 4);

  // Keep only the first chunk we see per (sourceType, sourceId).
  const seen = new Set<string>();
  const out: KnowledgeHit[] = [];
  for (const row of rows) {
    const key = `${row.sourceType}:${row.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      title: row.title,
      anchor: row.anchor,
      content: row.content,
      similarity: 0,
      updatedAt: row.updatedAt,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    });
    if (out.length >= k) break;
  }
  return out;
}
