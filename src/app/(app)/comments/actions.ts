"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { boards, comments, designs } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { resolveMentionsForTeam } from "@/lib/comments/mention-parser";
import { requireActiveTeam } from "@/lib/permissions";

const MAX_COMMENT_LENGTH = 4000;

export type CommentSubject = "board" | "design";

interface SubjectGuardResult {
  teamId: string;
  authorId: string;
  subjectName: string;
}

/**
 * Confirms the actor is on a team that owns the comment subject. Returns
 * the team id (the subject's team, since the active team must equal it),
 * the author id, and the subject name for activity-log snapshots.
 */
async function authorizeSubject(
  subjectType: CommentSubject,
  subjectId: string,
): Promise<SubjectGuardResult> {
  const { session, teamId } = await requireActiveTeam();

  if (subjectType === "board") {
    const row = await db.query.boards.findFirst({
      where: and(eq(boards.id, subjectId), eq(boards.teamId, teamId)),
      columns: { id: true, name: true },
    });
    if (!row) throw new Error("Board not found");
    return { teamId, authorId: session.user.id, subjectName: row.name };
  }

  const row = await db.query.designs.findFirst({
    where: and(eq(designs.id, subjectId), eq(designs.teamId, teamId)),
    columns: { id: true, name: true },
  });
  if (!row) throw new Error("Design not found");
  return { teamId, authorId: session.user.id, subjectName: row.name };
}

/* ─── create ─────────────────────────────────────────── */

export async function createComment(input: {
  subjectType: CommentSubject;
  subjectId: string;
  /** Optional shape (board) or DesignNode (design) id this comment is pinned to. */
  targetId?: string | null;
  body: string;
}): Promise<{ id: string }> {
  const trimmed = input.body.trim();
  if (!trimmed) throw new Error("Comment can't be empty");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment is too long (max ${MAX_COMMENT_LENGTH} chars)`);
  }

  const { teamId, authorId, subjectName } = await authorizeSubject(
    input.subjectType,
    input.subjectId,
  );

  const mentionedUserIds = await resolveMentionsForTeam(trimmed, teamId);

  const [created] = await db
    .insert(comments)
    .values({
      teamId,
      authorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      targetId: input.targetId ?? null,
      body: trimmed,
      mentionedUserIds,
    })
    .returning({ id: comments.id });

  await logActivity({
    teamId,
    actorId: authorId,
    verb: "commented",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectName,
    metadata: {
      commentId: created.id,
      targetId: input.targetId ?? null,
      mentionedUserIds,
    },
  });

  revalidatePath(
    input.subjectType === "board"
      ? `/boards/${input.subjectId}`
      : `/designs/${input.subjectId}`,
  );

  return { id: created.id };
}

/* ─── delete ─────────────────────────────────────────── */

export async function deleteComment(commentId: string) {
  const { session, teamId } = await requireActiveTeam();

  const existing = await db.query.comments.findFirst({
    where: and(eq(comments.id, commentId), eq(comments.teamId, teamId)),
    columns: {
      id: true,
      authorId: true,
      subjectType: true,
      subjectId: true,
    },
  });
  if (!existing) throw new Error("Comment not found");

  // Authors can delete their own comments. Future: team admins / owners
  // can delete anyone's. For now we stay strict.
  if (existing.authorId !== session.user.id) {
    throw new Error("You can only delete your own comments");
  }

  await db
    .delete(comments)
    .where(and(eq(comments.id, commentId), eq(comments.teamId, teamId)));

  revalidatePath(
    existing.subjectType === "board"
      ? `/boards/${existing.subjectId}`
      : `/designs/${existing.subjectId}`,
  );
}

/* ─── list (server-side helpers) ─────────────────────── */

export interface CommentRow {
  id: string;
  body: string;
  targetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string;
    username: string | null;
  };
  isYou: boolean;
}

/**
 * Loads every comment on a board / design, oldest first. Author info is
 * joined in so the UI can render names and avatars without an extra
 * round-trip per comment.
 */
export async function listCommentsForSubject(
  subjectType: CommentSubject,
  subjectId: string,
): Promise<CommentRow[]> {
  const { session, teamId } = await requireActiveTeam();

  const rows = await db.query.comments.findMany({
    where: and(
      eq(comments.teamId, teamId),
      eq(comments.subjectType, subjectType),
      eq(comments.subjectId, subjectId),
    ),
    orderBy: asc(comments.createdAt),
    with: {
      author: {
        columns: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    targetId: row.targetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.author.id,
      name: row.author.name,
      username: row.author.displayUsername ?? row.author.username,
    },
    isYou: row.author.id === session.user.id,
  }));
}
