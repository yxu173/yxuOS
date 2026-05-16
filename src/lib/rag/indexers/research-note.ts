import { eq } from "drizzle-orm";

import { db } from "@/db";
import { researchNotes } from "@/db/schema";

import { chunkMarkdown } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **research notes**.
 *
 * Every write path that mutates a research note's title, body, or
 * status calls `indexResearchNote(id)` from inside `after(...)` so the
 * embed + DB round-trip happens after the response is on the wire.
 * Mirror that with `unindexResearchNote(id)` on the delete path.
 *
 * Contract:
 *
 * - **Fresh fetch**, not a passed-in row. The caller already wrote
 *   the patch; we want the post-write state. This also keeps the
 *   indexer cheap to call from anywhere — give it an id and it does
 *   the right thing.
 *
 * - **Never throws.** Indexing is best-effort background work; a
 *   failure here must not surface as a user-visible error or stall
 *   the next action. We log and move on.
 *
 * - **Self-healing.** If the row is missing (race vs delete) or
 *   the note has been archived or emptied, we delete any stale
 *   chunks so the brain doesn't keep tombstones around.
 *
 * - **Title is folded into the embedded text** as an H1 prefix.
 *   `chunkMarkdown` already prepends section headings to every
 *   chunk for context; making the title the top-level heading
 *   means a search for the title alone hits every chunk of the
 *   note. High-signal, near-zero cost.
 */
export async function indexResearchNote(noteId: string): Promise<void> {
  try {
    const note = await db.query.researchNotes.findFirst({
      where: eq(researchNotes.id, noteId),
      columns: {
        id: true,
        teamId: true,
        projectId: true,
        title: true,
        body: true,
        status: true,
      },
    });

    // Row vanished between scheduling and running (delete race) —
    // make sure the brain doesn't carry stale chunks.
    if (!note) {
      await deleteKnowledgeForSource("research_note", noteId);
      return;
    }

    // Archived notes are deliberately out of scope for semantic
    // search: the user has signalled "this isn't current
    // knowledge anymore." Re-promoting (status → draft/reviewed)
    // re-runs this function and brings the chunks back.
    if (note.status === "archived") {
      await deleteKnowledgeForSource("research_note", noteId);
      return;
    }

    const title = note.title?.trim() ?? "";
    const body = note.body?.trim() ?? "";

    // Empty note — clean up any old chunks so search doesn't
    // serve a stale preview of a now-blank note.
    if (title.length === 0 && body.length === 0) {
      await deleteKnowledgeForSource("research_note", noteId);
      return;
    }

    const headed = title.length > 0 ? `# ${title}\n\n${body}` : body;
    const chunks = chunkMarkdown(headed);

    await upsertKnowledge({
      teamId: note.teamId,
      projectId: note.projectId,
      sourceType: "research_note",
      sourceId: noteId,
      title: note.title,
      metadata: { status: note.status },
      chunks,
    });
  } catch (err) {
    // Stay silent in dev when embeddings are unconfigured — the
    // upsert path already short-circuits cleanly in that case. We
    // only land here on real failures (DB error, embedding API
    // outage, etc.).
    console.error(
      `[rag/research-note] indexResearchNote(${noteId}) failed:`,
      formatRagError(err),
    );
  }
}

/**
 * Remove every chunk for a research note from the brain. Called
 * from the delete action; safe to call repeatedly.
 */
export async function unindexResearchNote(noteId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("research_note", noteId);
  } catch (err) {
    console.error(
      `[rag/research-note] unindexResearchNote(${noteId}) failed:`,
      formatRagError(err),
    );
  }
}
