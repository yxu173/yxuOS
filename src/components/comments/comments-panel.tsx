"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  createComment,
  type CommentSubject,
} from "@/app/(app)/comments/actions";

import { CommentComposer } from "./comment-composer";
import { CommentItem } from "./comment-item";
import type { CommentItemData, MentionTarget } from "./types";

export interface CommentsPanelProps {
  subjectType: CommentSubject;
  subjectId: string;
  initialComments: CommentItemData[];
  members: MentionTarget[];
  /**
   * Optional pinned target the composer attaches new comments to —
   * usually the currently selected shape (boards) or DesignNode (designs).
   */
  pinnedTargetId?: string | null;
  /** Optional readable label for the pinned target ("auth box", node id). */
  pinnedTargetLabel?: string | null;
  /** Optional click handler used to focus a shape/node when its comment is clicked. */
  onTargetClick?: (targetId: string) => void;
  /** Optional human label resolver for the "on …" pill on each comment. */
  resolveTargetLabel?: (targetId: string) => string | null;
  /** Hook so the consumer can clear the pinned context without our help. */
  onClearPinnedTarget?: () => void;
}

/**
 * Shared comments column for both surfaces (boards + designs).
 *
 * The list comes in already sorted (oldest first). When the actor posts
 * a new comment we optimistically tack it onto the local state — the
 * server action's `revalidatePath` will reconcile it on the next render.
 */
export function CommentsPanel({
  subjectType,
  subjectId,
  initialComments,
  members,
  pinnedTargetId,
  pinnedTargetLabel,
  onTargetClick,
  resolveTargetLabel,
  onClearPinnedTarget,
}: CommentsPanelProps) {
  const [comments, setComments] = useState(initialComments);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [, startTransition] = useTransition();

  // Reconcile when the parent passes fresh server state in (after revalidation).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setComments(initialComments);
  }, [initialComments]);

  // Auto-scroll to the bottom on new comments — the panel reads chronologically.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  const handleSubmit = (body: string) =>
    new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          await createComment({
            subjectType,
            subjectId,
            targetId: pinnedTargetId ?? null,
            body,
          });
          // Server returns just an id; we'll get the full row on the next
          // server render (revalidatePath fired in createComment). Until
          // then, optimistically render a placeholder so the user sees
          // their comment immediately.
          setComments((prev) => [
            ...prev,
            {
              id: `pending-${Date.now()}`,
              body,
              targetId: pinnedTargetId ?? null,
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

  const contextLabel = pinnedTargetId
    ? pinnedTargetLabel
      ? `Commenting on ${pinnedTargetLabel}`
      : "Commenting on selected element"
    : null;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
      >
        {comments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 pt-8 text-center">
            <MessageCircle className="size-5 text-zinc-600" />
            <p className="text-xs text-zinc-500">
              No comments yet. Drop the first one — @mention a teammate to
              loop them in.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {comments.map((comment) => (
              <li key={comment.id}>
                <CommentItem
                  comment={comment}
                  targetLabel={
                    comment.targetId
                      ? (resolveTargetLabel?.(comment.targetId) ?? null)
                      : null
                  }
                  onTargetClick={onTargetClick}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CommentComposer
        contextLabel={contextLabel}
        members={members}
        onSubmit={handleSubmit}
        onClearContext={onClearPinnedTarget}
      />
    </div>
  );
}
