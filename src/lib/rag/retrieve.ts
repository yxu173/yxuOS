import { sql } from "drizzle-orm";

import { db } from "@/db";
import { type KnowledgeKind } from "@/db/schema/project-knowledge";
import type { ProjectListItem } from "@/lib/projects";

import { embedQuery, isEmbeddingsEnabled } from "./embed";

/**
 * Retrieval API for the project brain.
 *
 * One entry point: `searchProjectKnowledge`. Everything else (Cmd+K
 * semantic mode, the agent `search_project_knowledge` tool, the
 * `/brain` page) routes through here so we have a single place to
 * tune ranking, add reranking later, etc.
 *
 * Permission contract: the caller is responsible for proving the
 * user belongs to the team that owns `projectId`. We deliberately
 * don't take a `teamId` filter here — the unique index on the
 * source side keeps cross-project rows out, and the project-id
 * filter is sufficient.
 */

export interface KnowledgeHit {
  id: string;
  sourceType: KnowledgeKind;
  sourceId: string;
  chunkIndex: number;
  title: string | null;
  anchor: string | null;
  content: string;
  /**
   * Cosine similarity in `[0, 1]` — higher = closer. Computed as
   * `1 - (embedding <=> query)` (cosine distance). Use this for UI
   * affordances ("strong match" vs "weak match") and to drop hits
   * below a threshold in the agent tool.
   */
  similarity: number;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  projectId: string;
  query: string;
  /** Top-K results. Defaults to 8 — the sweet spot for tool-use prompts. */
  k?: number;
  /** Optional kind filter ('only research notes', 'only plans', …). */
  kinds?: KnowledgeKind[];
  /**
   * Drop hits below this similarity. Default 0.2 — anything below
   * is essentially noise on our embedding model. The agent tool
   * tightens this further (~0.3) to avoid distracting the model
   * with marginal hits.
   */
  minSimilarity?: number;
}

const DEFAULT_K = 8;
const DEFAULT_MIN_SIM = 0.2;

/**
 * Semantic search across the project brain.
 *
 * Returns top-K chunks by cosine similarity. Below-threshold hits
 * are filtered out before returning, so the caller can rely on the
 * result list being "the actually useful matches" rather than the
 * raw top-K.
 *
 * When embeddings are disabled (no `OPENAI_API_KEY`) or the query
 * is empty, returns `[]` rather than throwing — keeps higher-level
 * code (Cmd+K, agent tools) simple.
 */
export async function searchProjectKnowledge(
  opts: SearchOptions,
): Promise<KnowledgeHit[]> {
  if (!isEmbeddingsEnabled()) return [];
  const trimmed = opts.query.trim();
  if (trimmed.length === 0) return [];

  const queryVec = await embedQuery(trimmed);
  if (!queryVec) return [];

  const k = opts.k ?? DEFAULT_K;
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIM;
  // pgvector wants the literal `[x,y,z]` text format. We build the
  // SQL inline because driver param binding for the `vector` type
  // varies; the text form works on every Neon driver we use.
  const vecLiteral = `[${queryVec.join(",")}]`;

  // The `kinds` filter is interpolated as a JSON array literal so
  // we don't need a separate `IN (...)` builder.
  const kindFilterSql = opts.kinds && opts.kinds.length > 0
    ? sql`AND source_type = ANY(${opts.kinds})`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      id,
      source_type,
      source_id,
      chunk_index,
      title,
      anchor,
      content,
      updated_at,
      metadata,
      1 - (embedding <=> ${vecLiteral}::vector) AS similarity
    FROM project_knowledge
    WHERE project_id = ${opts.projectId}
    ${kindFilterSql}
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${k}
  `);

  // `db.execute` returns the raw row shape. Drizzle types it as
  // `Record<string, unknown>`; we narrow per-column.
  const hits: KnowledgeHit[] = [];
  // `rows` may be the array directly (neon-http) or wrapped in
  // `{ rows }` (neon-serverless pg). Normalise.
  const rowArr = Array.isArray(rows)
    ? rows
    : ((rows as { rows: unknown[] }).rows ?? []);
  for (const raw of rowArr) {
    const r = raw as Record<string, unknown>;
    const similarity = Number(r.similarity ?? 0);
    if (similarity < minSim) continue;
    hits.push({
      id: String(r.id),
      sourceType: r.source_type as KnowledgeKind,
      sourceId: String(r.source_id),
      chunkIndex: Number(r.chunk_index),
      title: (r.title as string) ?? null,
      anchor: (r.anchor as string) ?? null,
      content: String(r.content),
      similarity,
      updatedAt: new Date(r.updated_at as string),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    });
  }
  return hits;
}

/**
 * Build the canonical link for a knowledge hit. Lives here so the
 * URL shape is centralised — Cmd+K, the brain page, and the
 * agent tool all share the same logic.
 */
export function hrefForHit(
  hit: KnowledgeHit,
  project: Pick<ProjectListItem, "slug">,
): string | null {
  switch (hit.sourceType) {
    case "research_note":
      return `/p/${project.slug}/research/${hit.sourceId}`;
    case "task_plan":
    case "task_plan_row":
      // Plan rows live inside the plan page; for now we just link
      // to the plan (a later iteration can scroll to the row).
      return `/p/${project.slug}/plans/${hit.sourceId}`;
    case "task":
      return `/p/${project.slug}/tasks/${hit.sourceId}`;
    case "board":
      return `/p/${project.slug}/boards/${hit.sourceId}`;
    case "design":
    case "design_chat":
      return `/p/${project.slug}/designs/${hit.sourceId}`;
    case "comment":
      // Comments don't have a standalone page; the indexer stores
      // the parent artifact id in `metadata.parent` so we can
      // route there.
      return null;
    default:
      return null;
  }
}
