import { eq } from "drizzle-orm";

import { db } from "@/db";
import { designs } from "@/db/schema";

import { approxTokens, chunkText, type Chunk } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **designs**.
 *
 * Designs are visual artifacts (artboards + node trees + tokens).
 * There's no `body` column to embed — the "knowledge" inside a
 * design is its name plus the labelled text that floats inside its
 * node tree: artboard names, text nodes, link labels.
 *
 * Strategy:
 *
 *   - Chunk 0: design name + a one-line "design has N artboards"
 *     summary so the launcher can still surface the design by name
 *     even when it has zero text content.
 *   - Chunk 1..N: result of walking the snapshot tree for any
 *     human-readable strings (`name`, `text`, `label`, `value`)
 *     and chunking the concatenated stream with `chunkText`.
 *
 * The walker is intentionally loose-typed — `unknown` accessors
 * with guards — so a stale or partial snapshot shape never
 * crashes the indexer. Same defensive style as
 * `boardSnapshotToDigest`.
 */
export async function indexDesign(designId: string): Promise<void> {
  try {
    const design = await db.query.designs.findFirst({
      where: eq(designs.id, designId),
      columns: {
        id: true,
        teamId: true,
        projectId: true,
        name: true,
        snapshot: true,
      },
    });

    if (!design) {
      await deleteKnowledgeForSource("design", designId);
      return;
    }
    if (!design.projectId) {
      // Project-less design — out of scope for project-scoped brain.
      await deleteKnowledgeForSource("design", designId);
      return;
    }

    const name = design.name?.trim() || "Untitled design";
    const { artboardCount, texts } = walkDesignSnapshot(design.snapshot);

    const headerLines = [`# ${name}`];
    headerLines.push(`design: ${artboardCount} artboard${artboardCount === 1 ? "" : "s"}`);
    const titleChunk: Chunk = {
      content: headerLines.join("\n"),
      tokens: approxTokens(headerLines.join("\n")),
    };

    const chunks: Chunk[] = [titleChunk];
    if (texts.length > 0) {
      // Concatenate everything we found with newline separation, then
      // let the general-purpose chunker pack it. We don't preserve
      // per-node anchors yet — would require routing the original
      // DesignNode id through, which is a v2 concern.
      const body = texts.join("\n");
      const bodyChunks = chunkText(body);
      chunks.push(...bodyChunks);
    }

    await upsertKnowledge({
      teamId: design.teamId,
      projectId: design.projectId,
      sourceType: "design",
      sourceId: designId,
      title: design.name,
      metadata: { artboardCount },
      chunks,
    });
  } catch (err) {
    console.error(
      `[rag/design] indexDesign(${designId}) failed:`,
      formatRagError(err),
    );
  }
}

export async function unindexDesign(designId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("design", designId);
  } catch (err) {
    console.error(
      `[rag/design] unindexDesign(${designId}) failed:`,
      formatRagError(err),
    );
  }
}

/**
 * Walk a design snapshot and pull every human-readable string out
 * of the node tree. Returns artboard count + the flat text stream.
 *
 * We look at `artboards[].name`, `artboards[].root` (DesignNode
 * tree), and inside each node we treat `name`, `text`, `label`,
 * `value` as readable. Recursion is bounded by tree depth, which
 * Mastra-side limits keep small.
 */
function walkDesignSnapshot(
  snapshot: unknown,
): { artboardCount: number; texts: string[] } {
  if (!snapshot || typeof snapshot !== "object") {
    return { artboardCount: 0, texts: [] };
  }
  const raw = snapshot as { artboards?: unknown };
  const artboards = Array.isArray(raw.artboards) ? raw.artboards : [];
  const texts: string[] = [];

  for (const artboard of artboards) {
    if (!artboard || typeof artboard !== "object") continue;
    const ab = artboard as { name?: unknown; root?: unknown };
    if (typeof ab.name === "string" && ab.name.trim().length > 0) {
      texts.push(`Artboard: ${ab.name.trim()}`);
    }
    walkNode(ab.root, texts);
  }

  return { artboardCount: artboards.length, texts };
}

/** Recursively collect readable fields. Tolerant of any shape. */
function walkNode(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  for (const key of ["name", "text", "label", "value"] as const) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) {
      out.push(v.trim());
    }
  }

  const children = obj.children;
  if (Array.isArray(children)) {
    for (const child of children) walkNode(child, out);
  }
}
