/**
 * Chunking helpers for the project brain.
 *
 * Indexers are responsible for *shaping* an artifact's content into a
 * canonical text form. The chunker takes that text and slices it into
 * embedding-sized pieces. We keep the chunker dumb on purpose: any
 * structural cleverness (header awareness, plan-row boundaries, board
 * frame grouping) belongs in the indexer that owns the artifact.
 *
 * Budget model: chunks target ~800 tokens with ~120 token overlap,
 * which fits comfortably inside the embedding model's 8K input limit
 * and gives enough overlap that a query straddling a chunk boundary
 * still hits at least one neighbour. We approximate token counts as
 * `text.length / 4` — accurate to within 15% for English prose and
 * cheap enough to run on every chunk without a real tokenizer.
 */

export interface Chunk {
  /** Chunk text. Already trimmed; safe to pass to the embedder. */
  content: string;
  /** Approximate token count. Used for budgeting + persisted as `tokens`. */
  tokens: number;
  /**
   * Optional sub-artifact identifier (e.g. a plan-row id or board-shape
   * id) that pins this chunk to a precise location inside the artifact.
   * Stored on `project_knowledge.anchor` for citation purposes.
   */
  anchor?: string;
}

export interface ChunkTextOptions {
  /** Target chunk size in approximate tokens. Default: 800. */
  maxTokens?: number;
  /** Overlap between consecutive chunks. Default: 120. */
  overlap?: number;
  /** Hard floor — chunks below this many tokens are merged with neighbours. */
  minTokens?: number;
}

const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_OVERLAP = 120;
const DEFAULT_MIN_TOKENS = 32;

/**
 * Naïve character-to-token approximation. Good enough for chunk
 * sizing — we'd only need a real tokenizer if we were squeezing
 * against the model's context window, which we never are.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Slice plain text into overlapping chunks at paragraph boundaries.
 *
 * Boundary order: blank lines (\n\n) → single newlines → sentence
 * boundaries (period/?/!) → hard character cut. We walk down the
 * preference list per chunk; in practice the first level catches
 * 95% of prose.
 */
export function chunkText(
  text: string,
  options: ChunkTextOptions = {},
): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Fast path: whole text fits in one chunk.
  if (approxTokens(trimmed) <= maxTokens) {
    return [{ content: trimmed, tokens: approxTokens(trimmed) }];
  }

  // Split on paragraph breaks first; if any paragraph itself is too
  // big, recursively split on weaker boundaries.
  const paragraphs = splitBoundary(trimmed, /\n\s*\n+/);
  const sized: string[] = [];
  for (const para of paragraphs) {
    if (approxTokens(para) <= maxTokens) {
      sized.push(para);
      continue;
    }
    // Paragraph too big — try single newlines, then sentences, then
    // a hard cut.
    const lines = splitBoundary(para, /\n+/);
    for (const line of lines) {
      if (approxTokens(line) <= maxTokens) {
        sized.push(line);
        continue;
      }
      const sentences = splitBoundary(line, /(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        if (approxTokens(sentence) <= maxTokens) {
          sized.push(sentence);
          continue;
        }
        // Worst case: hard character cut. Pick a window that's roughly
        // `maxTokens * 4` chars, with overlap on both ends so a query
        // straddling a cut still hits.
        const window = maxTokens * 4;
        const step = window - overlap * 4;
        for (let i = 0; i < sentence.length; i += step) {
          sized.push(sentence.slice(i, i + window));
        }
      }
    }
  }

  // Greedy pack: glue consecutive pieces until the next one would
  // push us past `maxTokens`. Carry the tail (`overlap` tokens) into
  // the next chunk so we get the desired overlap.
  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferTokens = 0;

  const flush = () => {
    const trimmedBuf = buffer.trim();
    if (trimmedBuf.length === 0) return;
    const tokens = approxTokens(trimmedBuf);
    // Merge under-sized tails into the previous chunk so we don't
    // emit a one-paragraph orphan from the end of a doc.
    if (tokens < minTokens && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]!;
      chunks[chunks.length - 1] = {
        content: `${prev.content}\n\n${trimmedBuf}`.trim(),
        tokens: prev.tokens + tokens,
      };
      return;
    }
    chunks.push({ content: trimmedBuf, tokens });
  };

  for (const piece of sized) {
    const pieceTokens = approxTokens(piece);
    if (bufferTokens + pieceTokens > maxTokens && bufferTokens > 0) {
      flush();
      // Seed the next buffer with the tail of the previous chunk.
      const tail = takeTail(buffer, overlap);
      buffer = tail.length > 0 ? `${tail}\n\n${piece}` : piece;
      bufferTokens = approxTokens(buffer);
      continue;
    }
    buffer = buffer.length > 0 ? `${buffer}\n\n${piece}` : piece;
    bufferTokens += pieceTokens;
  }
  flush();

  return chunks;
}

/**
 * Chunk a Markdown body header-aware. Each top-level section (`#`,
 * `##`, `###`) becomes its own greedy-packed chunk, with the section
 * heading prefixed onto every chunk so the embedder sees the local
 * context.
 *
 * Falls back to `chunkText` for body content that has no headers.
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkTextOptions = {},
): Chunk[] {
  const trimmed = markdown.trim();
  if (trimmed.length === 0) return [];

  // Split on lines starting with 1-3 hashes followed by a space.
  // We keep the heading lines attached to their section.
  const lines = trimmed.split(/\r?\n/);
  const sections: { heading: string | null; body: string }[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const commit = () => {
    const body = currentBody.join("\n").trim();
    if (body.length > 0 || currentHeading) {
      sections.push({ heading: currentHeading, body });
    }
    currentBody = [];
  };

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      commit();
      currentHeading = line.trim();
    } else {
      currentBody.push(line);
    }
  }
  commit();

  if (sections.length === 1 && !sections[0]!.heading) {
    // No headings — degrade to plain chunking.
    return chunkText(trimmed, options);
  }

  // Each section is chunked independently, with its heading prepended
  // to every chunk for embedder context.
  const out: Chunk[] = [];
  for (const section of sections) {
    const prefix = section.heading ? `${section.heading}\n\n` : "";
    const text = section.body.length > 0 ? section.body : section.heading ?? "";
    if (text.length === 0) continue;
    const sub = chunkText(text, options);
    for (const chunk of sub) {
      const content =
        prefix && !chunk.content.startsWith(section.heading!.slice(0, 12))
          ? `${prefix}${chunk.content}`
          : chunk.content;
      out.push({
        content,
        tokens: approxTokens(content),
      });
    }
  }

  // If for some reason we emitted nothing (e.g. only a heading), fall
  // back to a single-chunk result so the artifact is still indexable.
  if (out.length === 0) {
    return [{ content: trimmed, tokens: approxTokens(trimmed) }];
  }

  return out;
}

/**
 * Chunk a list of homogeneous rows (plan rows, tasks in a board, …)
 * where each row should be retrievable on its own. Each row produces
 * exactly one chunk, with an `anchor` so the citation links back to
 * the precise row.
 *
 * The caller supplies a `format` function that renders one row into
 * its text representation. Empty results from `format` are skipped.
 */
export function chunkRows<T>(
  rows: T[],
  format: (row: T, index: number) => { content: string; anchor?: string },
): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const { content, anchor } = format(rows[i]!, i);
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    out.push({
      content: trimmed,
      tokens: approxTokens(trimmed),
      anchor,
    });
  }
  return out;
}

/* ─── internals ─────────────────────────────────────────── */

function splitBoundary(text: string, boundary: RegExp): string[] {
  return text
    .split(boundary)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Take the last ~`tokens` worth of characters from a string. */
function takeTail(text: string, tokens: number): string {
  if (tokens <= 0) return "";
  const chars = tokens * 4;
  if (text.length <= chars) return text;
  // Snap to a whitespace boundary so we don't slice mid-word.
  const cut = text.length - chars;
  const space = text.indexOf(" ", cut);
  return text.slice(space === -1 ? cut : space + 1).trim();
}
