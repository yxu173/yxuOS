import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

import { env } from "@/lib/env";

/**
 * Embedding gateway for the project brain.
 *
 * One choice point in the entire codebase. Every indexer goes through
 * `embedTexts` (batched, for chunking) or `embedQuery` (single query
 * vector); both call the same model on the same client.
 *
 * Model: `text-embedding-3-small` — 1536 dims, ~$0.02 / 1M tokens.
 * Cheap enough that we re-embed entire artifacts on every save
 * without thinking about it; good enough that we don't need a
 * reranker for project-scale corpora.
 *
 * Key handling mirrors the Exa pattern (`tools/exa-search.ts`): when
 * `OPENAI_API_KEY` is unset, embedding helpers return empty arrays
 * (or a zero vector) instead of throwing. That keeps the rest of
 * the app functional in a fresh dev environment that hasn't been
 * configured with embeddings yet — the brain just has nothing in it.
 */

/** Dimensions for `text-embedding-3-small`. Matches the DB column. */
export const EMBED_DIMENSIONS = 1536;

/** Identifier persisted on each chunk's metadata. Used by reindex tooling. */
export const EMBED_MODEL_ID = "text-embedding-3-small";

/**
 * Maximum number of inputs per `embedMany` call. OpenAI accepts up
 * to 2048 in a single request; 96 keeps individual HTTP timeouts
 * sane and surfaces transient errors on smaller blast radii.
 */
const BATCH_SIZE = 96;

let _client: ReturnType<typeof createOpenAI> | null = null;
function client(): ReturnType<typeof createOpenAI> | null {
  if (_client) return _client;
  if (!env.OPENAI_API_KEY) return null;
  _client = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

/** True when embeddings are wired (`OPENAI_API_KEY` is configured). */
export function isEmbeddingsEnabled(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * Batch-embed a list of texts. Empty inputs map to zero vectors so
 * callers can build positional arrays without filtering — the brain
 * skips zero-vector chunks at retrieval time anyway.
 *
 * Returns an empty array when embeddings are disabled, so the
 * caller can no-op the persistence step cleanly.
 */
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const c = client();
  if (!c) return [];

  const model = c.embedding(EMBED_MODEL_ID);
  const out: number[][] = new Array(inputs.length);

  // Chunk into BATCH_SIZE-sized slices. OpenAI silently truncates
  // inputs >8 KB per item, which is fine for our ~800-token cap.
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);

    // Filter out empty strings; the OpenAI API rejects them. We
    // still need to keep the positional shape, so empty positions
    // get a zero vector synthesised locally.
    const nonEmptyIndices: number[] = [];
    const nonEmptyValues: string[] = [];
    for (let j = 0; j < slice.length; j += 1) {
      if (slice[j]!.length > 0) {
        nonEmptyIndices.push(j);
        nonEmptyValues.push(slice[j]!);
      }
    }

    if (nonEmptyValues.length > 0) {
      const result = await embedMany({
        model,
        values: nonEmptyValues,
        maxRetries: 3,
      });
      for (let k = 0; k < nonEmptyIndices.length; k += 1) {
        out[i + nonEmptyIndices[k]!] = result.embeddings[k]!;
      }
    }

    // Pad the empty positions with zero vectors.
    for (let j = 0; j < slice.length; j += 1) {
      if (out[i + j] === undefined) {
        out[i + j] = zeroVector();
      }
    }
  }

  return out;
}

/**
 * Embed a single query string. Returns `null` when embeddings are
 * disabled — callers should bail out (the brain has nothing to
 * search against anyway).
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const c = client();
  if (!c) return null;
  if (query.trim().length === 0) return null;
  const model = c.embedding(EMBED_MODEL_ID);
  const result = await embed({
    model,
    value: query,
    maxRetries: 3,
  });
  return result.embedding;
}

function zeroVector(): number[] {
  return new Array(EMBED_DIMENSIONS).fill(0);
}
