import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { boards, comments, designs, tasks } from "@/db/schema";

import { approxTokens, type Chunk } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **comments**.
 *
 * Comments are short (max ~2 KB), they don't carry their own
 * `projectId`, and they're polymorphic across board / design /
 * task subjects. So indexing one comment requires:
 *
 *   1. Resolve the parent subject's `projectId` (and skip if the
 *      parent is project-less, which currently only happens for
 *      legacy boards/designs that predate the project rollout).
 *   2. Emit one single chunk per comment with the body. Comments
 *      are short enough that splitting would be wasteful — even
 *      a 2 KB comment is ~500 tokens, well under the 800-token
 *      soft cap.
 *
 * Source layout: `source_type = "comment"`, `source_id = commentId`
 * (not the parent id, because we want one-row-per-comment lifecycle).
 * `anchor` carries the comment id again — redundant but symmetric
 * with the other indexers. Parent info goes into `metadata` so
 * `hrefForHit` can resolve a link back to the surface.
 */
export async function indexComment(commentId: string): Promise<void> {
  try {
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: {
        id: true,
        teamId: true,
        authorId: true,
        subjectType: true,
        subjectId: true,
        targetId: true,
        body: true,
      },
    });

    if (!comment) {
      await deleteKnowledgeForSource("comment", commentId);
      return;
    }

    const parentProjectId = await resolveParentProjectId(
      comment.subjectType,
      comment.subjectId,
      comment.teamId,
    );
    if (!parentProjectId) {
      // Parent missing or project-less — drop any stale chunk and
      // move on. The parent's own indexer will clean up too.
      await deleteKnowledgeForSource("comment", commentId);
      return;
    }

    const body = comment.body?.trim() ?? "";
    if (body.length === 0) {
      await deleteKnowledgeForSource("comment", commentId);
      return;
    }

    // Prefix the comment with its parent type so a query like
    // "what did the team say about the export bug" surfaces the
    // right kind of comment, and so the embedding picks up the
    // structural context (this is a *comment* about a *board*, not
    // a research note).
    const content = `Comment on ${comment.subjectType}:\n${body}`;
    const chunk: Chunk = {
      content,
      tokens: approxTokens(content),
      anchor: comment.id,
    };

    await upsertKnowledge({
      teamId: comment.teamId,
      projectId: parentProjectId,
      sourceType: "comment",
      sourceId: commentId,
      // No standalone "comment title" — the brain UI will show the
      // first ~80 chars of the body as the preview. Pass null
      // here rather than synthesising a fake title.
      title: null,
      metadata: {
        parentType: comment.subjectType,
        parentId: comment.subjectId,
        targetId: comment.targetId,
        authorId: comment.authorId,
      },
      chunks: [chunk],
    });
  } catch (err) {
    console.error(
      `[rag/comment] indexComment(${commentId}) failed:`,
      formatRagError(err),
    );
  }
}

export async function unindexComment(commentId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("comment", commentId);
  } catch (err) {
    console.error(
      `[rag/comment] unindexComment(${commentId}) failed:`,
      formatRagError(err),
    );
  }
}

/**
 * Look up the parent subject's project id. Returns null if the
 * parent is missing, on a different team, or project-less. We
 * never join blindly — the team match is part of the lookup so
 * we don't surface a cross-team subject under the wrong project.
 */
async function resolveParentProjectId(
  subjectType: string,
  subjectId: string,
  teamId: string,
): Promise<string | null> {
  if (subjectType === "board") {
    const row = await db.query.boards.findFirst({
      where: and(eq(boards.id, subjectId), eq(boards.teamId, teamId)),
      columns: { projectId: true },
    });
    return row?.projectId ?? null;
  }
  if (subjectType === "design") {
    const row = await db.query.designs.findFirst({
      where: and(eq(designs.id, subjectId), eq(designs.teamId, teamId)),
      columns: { projectId: true },
    });
    return row?.projectId ?? null;
  }
  if (subjectType === "task") {
    const row = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, subjectId), eq(tasks.teamId, teamId)),
      columns: { projectId: true },
    });
    return row?.projectId ?? null;
  }
  return null;
}
