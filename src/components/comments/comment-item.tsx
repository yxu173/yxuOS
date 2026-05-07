"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";

import { deleteComment } from "@/app/(app)/comments/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CommentBody } from "./comment-body";
import type { CommentItemData } from "./types";

const RELATIVE_FMT = new Intl.RelativeTimeFormat("en", { style: "short" });

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 90) return RELATIVE_FMT.format(-1, "minute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 45) return RELATIVE_FMT.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return RELATIVE_FMT.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return RELATIVE_FMT.format(-days, "day");
  return dateFormatter.format(date);
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export interface CommentItemProps {
  comment: CommentItemData;
  /** Optional human label for the target (e.g. shape text or node id). */
  targetLabel?: string | null;
  /** Click handler when the comment is pinned to a target — used to focus the shape / node. */
  onTargetClick?: (targetId: string) => void;
}

export function CommentItem({
  comment,
  targetLabel,
  onTargetClick,
}: CommentItemProps) {
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("Delete this comment?")) return;
    startTransition(async () => {
      try {
        await deleteComment(comment.id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  };

  const targetClickable = comment.targetId && onTargetClick;

  return (
    <article className="flex gap-2.5 rounded-md p-2 transition-colors hover:bg-white/[0.02]">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-200">
        {initials(comment.author.name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <header className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium text-zinc-100">
            {comment.author.name}
            {comment.isYou ? (
              <span className="ml-1 font-normal text-zinc-500">(you)</span>
            ) : null}
          </span>
          <span
            className="text-[10px] text-zinc-500"
            title={dateFormatter.format(comment.createdAt)}
          >
            {relativeTime(comment.createdAt)}
          </span>
        </header>

        {comment.targetId ? (
          <button
            type="button"
            onClick={() =>
              targetClickable
                ? onTargetClick?.(comment.targetId!)
                : undefined
            }
            disabled={!targetClickable}
            className={cn(
              "self-start rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 transition-colors",
              targetClickable && "hover:border-sky-500/30 hover:text-sky-200",
            )}
          >
            on {targetLabel ?? "element"}
          </button>
        ) : null}

        <CommentBody body={comment.body} />

        {comment.isYou ? (
          <div className="flex">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
              className="h-6 px-1.5 text-[10px] text-zinc-500 hover:text-red-300"
            >
              <Trash2 className="size-3" />
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
