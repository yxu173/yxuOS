"use client";

import { Send } from "lucide-react";
import { useState, useTransition } from "react";

import { RichTextEditor } from "@/components/markdown/rich-text-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { MentionTarget } from "./types";

export interface CommentComposerProps {
  /** Optional context line (e.g. "Commenting on auth box"). */
  contextLabel?: string | null;
  /** Reserved for future @-mention autocomplete inside the rich editor. */
  members?: MentionTarget[];
  onSubmit: (body: string) => Promise<void>;
  /** Optional clear-context handler — when present, renders a small "×" next to the context label. */
  onClearContext?: () => void;
}

const MAX_LENGTH = 16_000;

/**
 * Inline composer for comments. Replaces the previous textarea + plain
 * `@` autocomplete with a TipTap-backed rich editor — paste, drop, or
 * click the toolbar's image button and the image renders inline as
 * you write. Server-side `@username` parsing is unchanged: type
 * `@handle` and the resolved teammate is captured in
 * `mentioned_user_ids` on save.
 */
export function CommentComposer({
  contextLabel,
  onSubmit,
  onClearContext,
}: CommentComposerProps) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEmpty = !plainText(value).trim();

  const submit = () => {
    if (isEmpty || pending) return;
    if (value.length > MAX_LENGTH) {
      setError(`Too long (max ${MAX_LENGTH.toLocaleString()} chars).`);
      return;
    }
    startTransition(async () => {
      try {
        await onSubmit(value);
        setValue("");
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to post comment",
        );
      }
    });
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 border-t border-white/5 bg-zinc-950/40 p-3",
      )}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      {contextLabel ? (
        <div className="flex items-center justify-between rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-200">
          <span className="truncate">{contextLabel}</span>
          {onClearContext ? (
            <button
              type="button"
              onClick={onClearContext}
              className="ml-2 text-sky-300 hover:text-sky-100"
              aria-label="Clear comment target"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      <RichTextEditor
        value={value}
        onChange={setValue}
        placeholder="Leave a comment — @mention a teammate, paste an image…"
        compact
        hideToolbar
        maxBodyHeight={200}
      />

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      <div className="flex items-center justify-end gap-2 text-[10px] text-zinc-500">
        <span className="ml-auto">
          <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
            ⌘
          </kbd>{" "}
          <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
            ⏎
          </kbd>{" "}
          to send
        </span>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || isEmpty}
          className="h-7 px-2.5"
        >
          <Send className="size-3" />
          {pending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Cheap "is empty" check for HTML — strips tags and trims, so a comment
 * with only an image still counts as non-empty (the editor still has a
 * `<p></p>` wrapper but also an `<img>`).
 */
function plainText(html: string): string {
  if (!html) return "";
  // If there's an image in the document the comment is non-empty even
  // when the surrounding paragraphs are blank.
  if (/<img\b/i.test(html)) return "image";
  return html.replace(/<[^>]*>/g, "");
}
