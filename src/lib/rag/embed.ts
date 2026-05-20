import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModelV3 } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";

import { env } from "@/lib/env";

/**
 * Embedding gateway for the project brain.
 *
 * One choice point in the entire codebase. Every indexer goes through
 * `embedTexts` (batched, for chunking) or `embedQuery` (single query
 * vector); both call the same model on the same client.
 *
 * # Provider selection
 *
 *   1. **OpenAI direct** — when `OPENAI_API_KEY` is set. Calls
 *      `text-embedding-3-small` (1536 dims) against api.openai.com.
 *
 *   2. **Disabled** — when not configured. Helpers return empty arrays /
 *      nulls so the rest of the app keeps working; the brain just has
 *      nothing in it.
 *
 * # Dimensions
 *
 * The DB column is fixed at **1536** dims (`vector(1536)`), set by
 * the initial migration. `text-embedding-3-small` is natively 1536 —
 * no override needed.
 *
 * # `EMBED_MODEL_ID`
 *
 * Persisted on each chunk's metadata. If we ever mix providers in
 * the same DB, this lets a future migration tell which rows need
 * re-embedding.
 */

/** Dimensions for the embedding column. Matches the `vector(1536)` DB type. */
export const EMBED_DIMENSIONS = 1536;

/** Tag for the active provider — surfaces in banners and chunk metadata. */
export type EmbeddingProviderKind = "openai";

/**
 * Maximum number of inputs per `embedMany` call. OpenAI accepts up
 * to 2048 in a single request; 96 keeps individual HTTP timeouts
 * sane and surfaces transient errors on smaller blast radii.
 */
const BATCH_SIZE = 96;

interface Provider {
  kind: EmbeddingProviderKind;
  /** Concrete model id we'll persist in `metadata.embedModel`. */
  modelId: string;
  /** Built embedding model handle. */
  model: EmbeddingModelV3;
  /**
   * Provider-specific options to pass on every embed call.
   * text-embedding-3-small is natively 1536 dims — no override needed.
   */
  providerOptions?: { openai: { dimensions?: number } };
}

let _provider: Provider | null | undefined;

/**
 * Resolve (and memoise) the active provider. Returns `null` when
 * `OPENAI_API_KEY` is not set — callers should treat that as
 * "embeddings disabled".
 */
function provider(): Provider | null {
  if (_provider !== undefined) return _provider;

  if (env.OPENAI_API_KEY) {
    const client = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    _provider = {
      kind: "openai",
      modelId: "text-embedding-3-small",
      model: client.embedding("text-embedding-3-small"),
      providerOptions: undefined,
    };
    return _provider;
  }

  _provider = null;
  return null;
}

/** Identifier persisted on each chunk's metadata. Used by reindex tooling. */
export function getEmbedModelId(): string {
  return provider()?.modelId ?? "unknown";
}



/** True when embeddings are wired (Azure or OpenAI). */
export function isEmbeddingsEnabled(): boolean {
  return provider() !== null;
}

/** Surface the active provider for banners / debug output. */
export function getEmbeddingProviderKind(): EmbeddingProviderKind | null {
  return provider()?.kind ?? null;
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
  const p = provider();
  if (!p) return [];

  const out: number[][] = new Array(inputs.length);

  // Chunk into BATCH_SIZE-sized slices. Both providers silently
  // truncate inputs >8 KB per item, which is fine for our ~800-token
  // cap.
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);

    // Filter out empty strings; both APIs reject them. We still need
    // to keep the positional shape, so empty positions get a zero
    // vector synthesised locally.
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
        model: p.model,
        values: nonEmptyValues,
        maxRetries: 3,
        providerOptions: p.providerOptions,
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
  const p = provider();
  if (!p) return null;
  if (query.trim().length === 0) return null;
  const result = await embed({
    model: p.model,
    value: query,
    maxRetries: 3,
    providerOptions: p.providerOptions,
  });
  return result.embedding;
}

function zeroVector(): number[] {
  return new Array(EMBED_DIMENSIONS).fill(0);
}
