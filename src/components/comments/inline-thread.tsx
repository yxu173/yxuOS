"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  createComment,
  type CommentSubject,
} from "@/app/(app)/comments/actions";

import { CommentComposer } from "./comment-composer";
import { CommentItem } from "./comment-item";
import type { CommentItemData, MentionTarget } from "./types";

export interface InlineCommentsThreadProps {
  subjectType: CommentSubject;
  subjectId: string;
  initialComments: CommentItemData[];
  members: MentionTarget[];
}

/**
 * Comments rendered inline as part of the page flow rather than inside a
 * fixed-height sidebar — used on the task detail page where the whole
 * page scrolls and comments are just one section among several.
 *
 * No scroll container, no auto-scroll, no pinned target. Just the list
 * (oldest first) and a composer below it.
 */
export function InlineCommentsThread({
  subjectType,
  subjectId,
  initialComments,
  members,
}: InlineCommentsThreadProps) {
  const [comments, setComments] = useState(initialComments);
  const [, startTransition] = useTransition();

  // Reconcile when the parent passes fresh server state in (after
  // revalidation). setState-in-effect is the standard prop-mirror pattern
  // for replacing optimistic placeholders with confirmed rows.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setComments(initialComments);
  }, [initialComments]);

  const handleSubmit = (body: string) =>
    new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          await createComment({
            subjectType,
            subjectId,
            targetId: null,
            body,
          });
          // Optimistic placeholder — server-revalidated row replaces it.
          setComments((prev) => [
            ...prev,
            {
              id: `pending-${Date.now()}`,
              body,
              targetId: null,
              createdAt: new Date(),
              author: {
                id: "you",
                name: "You",
                username: null,
              },
              isYou: true,
            },
          ]);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/5 bg-white/[0.02]">
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
        <MessageCircle className="size-3.5 text-zinc-500" />
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Comments ({comments.length})
        </h2>
      </header>

      {comments.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No comments yet. Drop the first one — @mention a teammate to loop
          them in.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 px-2 py-2">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentItem comment={comment} />
            </li>
          ))}
        </ul>
      )}

      <CommentComposer members={members} onSubmit={handleSubmit} />
    </section>
  );
}
