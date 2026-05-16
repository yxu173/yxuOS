import { createHash } from "node:crypto";

import { and, eq, gte, inArray, like } from "drizzle-orm";

import { db } from "@/db";
import {
  type KnowledgeKind,
  projectKnowledge,
} from "@/db/schema/project-knowledge";

import type { Chunk } from "./chunk";
import { embedTexts, getEmbedModelId, isEmbeddingsEnabled } from "./embed";

/**
 * Upsert a complete set of chunks for one artifact.
 *
 * Idempotency contract:
 *
 *   - Chunks are keyed on `(source_type, source_id, chunk_index)`.
 *   - For each chunk, we compare the new content's SHA-256 hash
 *     against the stored hash. Hits skip the embed call and update
 *     only mutable surfaces (title, metadata, updated_at).
 *   - After upsert, any rows whose `chunk_index >= chunks.length`
 *     are deleted — orphan cleanup for artifacts that have shrunk
 *     since the last index pass.
 *
 * This means: editing one paragraph in a long note re-embeds one
 * chunk and writes one row; the rest of the table is untouched.
 *
 * Called from per-artifact indexers (`src/lib/rag/indexers/*`).
 */
export interface UpsertOptions {
  teamId: string;
  projectId: string;
  sourceType: KnowledgeKind;
  sourceId: string;
  /**
   * Denormalised artifact title for the search UI. Stored on every
   * chunk so retrieval can render a useful preview without joining
   * back to the source table.
   */
  title?: string | null;
  /** Optional metadata captured on every row of this artifact. */
  metadata?: Record<string, unknown>;
  /** Ordered chunk list. Empty list ⇒ artifact is unindexed. */
  chunks: Chunk[];
}

export interface UpsertResult {
  /** Chunks that were newly embedded (content changed or row was new). */
  embedded: number;
  /** Chunks whose stored hash matched (no embed call made). */
  reused: number;
  /** Rows deleted because the new chunk list is shorter than before. */
  orphaned: number;
  /**
   * `true` when no work happened because embeddings are disabled
   * (no `OPENAI_API_KEY`). Callers can log a one-time warning.
   */
  skipped: boolean;
}

export async function upsertKnowledge(
  opts: UpsertOptions,
): Promise<UpsertResult> {
  // Fast no-op when embeddings aren't configured. The brain stays
  // empty; the rest of the app keeps working.
  if (!isEmbeddingsEnabled()) {
    return { embedded: 0, reused: 0, orphaned: 0, skipped: true };
  }

  const { teamId, projectId, sourceType, sourceId, chunks } = opts;
  // Resolve at call time, not import time, so the metadata reflects
  // whichever provider is actually active (Azure vs. OpenAI vs.
  // overridden via env at runtime).
  const baseMetadata = {
    embedModel: getEmbedModelId(),
    ...(opts.metadata ?? {}),
  };

  // Load existing rows for this source so we can diff hashes.
  const existing = await db
    .select({
      chunkIndex: projectKnowledge.chunkIndex,
      contentHash: projectKnowledge.contentHash,
    })
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, sourceType),
        eq(projectKnowledge.sourceId, sourceId),
      ),
    );
  const existingByIndex = new Map(
    existing.map((row) => [row.chunkIndex, row.contentHash]),
  );

  // Compute new hashes; figure out which chunks need a fresh embed.
  const newHashes = chunks.map((c) => sha256(c.content));
  const indicesToEmbed: number[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    if (existingByIndex.get(i) !== newHashes[i]) {
      indicesToEmbed.push(i);
    }
  }

  // Embed only the chunks that changed. Batched inside `embedTexts`.
  let embeddings: number[][] = [];
  if (indicesToEmbed.length > 0) {
    embeddings = await embedTexts(
      indicesToEmbed.map((i) => chunks[i]!.content),
    );
  }
  const embeddingsByIndex = new Map<number, number[]>();
  for (let k = 0; k < indicesToEmbed.length; k += 1) {
    embeddingsByIndex.set(indicesToEmbed[k]!, embeddings[k]!);
  }

  // Build the row payloads. For unchanged chunks we still need an
  // embedding for the INSERT path (in case the row was deleted
  // between fetch and write) — so we fetch those embeddings lazily
  // only if they're needed. In the common case (row exists), the
  // unchanged rows get an `onConflict` no-op and the embedding
  // value is discarded.
  //
  // We accept one extra DB read for the rare insert-after-delete
  // race; reusing the existing vector would require another SELECT
  // anyway, so the tradeoff is the same.
  const reusedEmbeddings = await fetchExistingEmbeddings({
    sourceType,
    sourceId,
    indices: chunks
      .map((_, i) => i)
      .filter((i) => !embeddingsByIndex.has(i)),
  });

  const rows = chunks.map((chunk, i) => {
    const embedding =
      embeddingsByIndex.get(i) ?? reusedEmbeddings.get(i) ?? null;
    return {
      teamId,
      projectId,
      sourceType,
      sourceId,
      chunkIndex: i,
      title: opts.title ?? null,
      anchor: chunk.anchor ?? null,
      content: chunk.content,
      contentHash: newHashes[i]!,
      tokens: chunk.tokens,
      // Only insert rows we actually have a vector for. Chunks
      // that reused a stale-on-write row keep their old embedding
      // via the conflict-target update below.
      embedding: embedding ?? new Array(0),
      metadata: baseMetadata,
      updatedAt: new Date(),
    };
  });

  // Drop the rows we can't insert (no embedding available — would
  // violate the NOT NULL constraint on `embedding`). In practice
  // this only happens if a previous run crashed mid-upsert; we'll
  // pick the chunk up on the next save.
  const insertable = rows.filter((r) => r.embedding.length > 0);

  if (insertable.length > 0) {
    // Upsert: on conflict, update everything but `embedding` (we
    // only changed the embedding when the hash differed, and in
    // that case the new row already carries the fresh vector).
    await db
      .insert(projectKnowledge)
      .values(insertable)
      .onConflictDoUpdate({
        target: [
          projectKnowledge.sourceType,
          projectKnowledge.sourceId,
          projectKnowledge.chunkIndex,
        ],
        set: {
          title: rows[0]!.title,
          anchor: projectKnowledge.anchor,
          content: projectKnowledge.content,
          contentHash: projectKnowledge.contentHash,
          tokens: projectKnowledge.tokens,
          embedding: projectKnowledge.embedding,
          metadata: projectKnowledge.metadata,
          updatedAt: new Date(),
        },
      });
  }

  // Orphan cleanup: any row whose chunk_index is past the new tail.
  let orphaned = 0;
  const oldMax = existing.reduce(
    (acc, row) => Math.max(acc, row.chunkIndex),
    -1,
  );
  if (oldMax >= chunks.length) {
    const deleted = await db
      .delete(projectKnowledge)
      .where(
        and(
          eq(projectKnowledge.sourceType, sourceType),
          eq(projectKnowledge.sourceId, sourceId),
          gte(projectKnowledge.chunkIndex, chunks.length),
        ),
      )
      .returning({ id: projectKnowledge.id });
    orphaned = deleted.length;
  }

  return {
    embedded: indicesToEmbed.length,
    reused: chunks.length - indicesToEmbed.length,
    orphaned,
    skipped: false,
  };
}

/**
 * Delete every chunk for an artifact. Called from the artifact's
 * delete server action so the brain doesn't carry tombstones.
 */
export async function deleteKnowledgeForSource(
  sourceType: KnowledgeKind,
  sourceId: string,
): Promise<void> {
  await db
    .delete(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, sourceType),
        eq(projectKnowledge.sourceId, sourceId),
      ),
    );
}

/**
 * Wipe every `repo_file` chunk belonging to a given repo. Used when
 * a repo is deleted or force-resynced.
 *
 * The `sourceId` shape for repo files is `"<repoId>:<path>"` (see
 * `indexers/repo-file.ts`), so a `LIKE '<repoId>:%'` prefix-match
 * is the right (and unambiguous) sweep. We pin `sourceType` too so
 * a hypothetical id-collision with another kind can't surface here.
 */
export async function deleteKnowledgeForRepoFiles(
  repoId: string,
): Promise<void> {
  await db
    .delete(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, "repo_file"),
        like(projectKnowledge.sourceId, `${repoId}:%`),
      ),
    );
}

/** Hex SHA-256, the dedupe signal for chunk content. */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Pull the embeddings for a known set of chunk indices on one
 * source. Used by the upsert path to keep unchanged chunks alive
 * if they happen to need re-insertion (rare).
 */
async function fetchExistingEmbeddings(opts: {
  sourceType: KnowledgeKind;
  sourceId: string;
  indices: number[];
}): Promise<Map<number, number[]>> {
  if (opts.indices.length === 0) return new Map();
  const rows = await db
    .select({
      chunkIndex: projectKnowledge.chunkIndex,
      embedding: projectKnowledge.embedding,
    })
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, opts.sourceType),
        eq(projectKnowledge.sourceId, opts.sourceId),
        inArray(projectKnowledge.chunkIndex, opts.indices),
      ),
    );
  return new Map(rows.map((row) => [row.chunkIndex, row.embedding]));
}
