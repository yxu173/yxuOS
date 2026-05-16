import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema";
import {
  boardSnapshotToDigest,
  type RawBoardSnapshot,
} from "@/lib/boards/snapshot-digest";

import { chunkText } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **boards**.
 *
 * Boards are dense visual scenes: frames, sticky notes, geo shapes,
 * arrows, full markdown cards and full mermaid diagrams. We can't
 * embed the JSON blob directly — `text-embedding-3-small` doesn't
 * understand element ids. Instead we route through the existing
 * `boardSnapshotToDigest`, which produces a section-grouped plain-
 * text rendering (Frames, Sticky notes, Shapes, Text, Markdown
 * cards, Mermaid cards, Connections).
 *
 * Trade-offs:
 *
 *   - Per-shape anchors are lost. The digest groups by kind so
 *     individual shape ids never appear in the text. We could add
 *     them back later by re-walking the snapshot here and emitting
 *     one chunk per shape, but the digest format is already what
 *     the agent reads for `@board` mentions — same source-of-truth
 *     for human-readable board content.
 *   - The 6 KB cap on the digest acts as an indirect chunk-budget.
 *     Most boards produce a single chunk; very dense ones split
 *     into 2-3 via `chunkText` (paragraph-aware).
 *   - Empty boards still index a single "(empty board)" chunk so
 *     the board name remains discoverable in the brain UI.
 */
export async function indexBoard(boardId: string): Promise<void> {
  try {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
      columns: {
        id: true,
        teamId: true,
        projectId: true,
        name: true,
        snapshot: true,
        updatedAt: true,
      },
      with: { project: { columns: { name: true } } },
    });

    if (!board) {
      await deleteKnowledgeForSource("board", boardId);
      return;
    }
    if (!board.projectId) {
      // Boards predating the project association are skipped — the
      // brain is project-scoped by design.
      await deleteKnowledgeForSource("board", boardId);
      return;
    }

    const digest = boardSnapshotToDigest({
      name: board.name,
      projectName: board.project?.name ?? null,
      snapshot: (board.snapshot as RawBoardSnapshot | null) ?? null,
      updatedAt: board.updatedAt,
    });

    // Strip the framing markers (`[mentioned-board: …]` … `[/mentioned-board]`)
    // — those are agent-prompt scaffolding, not knowledge content.
    // We keep the body but drop the wrapping lines so the embedding
    // gets clean text.
    const stripped = digest
      .replace(/^\[mentioned-board:[^\]]*\]\s*\n?/m, "")
      .replace(/\n?\[\/mentioned-board\]\s*$/m, "")
      .trim();

    if (stripped.length === 0) {
      await deleteKnowledgeForSource("board", boardId);
      return;
    }

    const chunks = chunkText(stripped);

    await upsertKnowledge({
      teamId: board.teamId,
      projectId: board.projectId,
      sourceType: "board",
      sourceId: boardId,
      title: board.name,
      metadata: {
        // Tag boards so the brain UI can render their preview as
        // "board" instead of generic text.
        projectName: board.project?.name ?? null,
      },
      chunks,
    });
  } catch (err) {
    console.error(
      `[rag/board] indexBoard(${boardId}) failed:`,
      formatRagError(err),
    );
  }
}

export async function unindexBoard(boardId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("board", boardId);
  } catch (err) {
    console.error(
      `[rag/board] unindexBoard(${boardId}) failed:`,
      formatRagError(err),
    );
  }
}
