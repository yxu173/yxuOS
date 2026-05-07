"use client";

import { ImagePlus, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { uploadAttachment } from "@/app/(app)/attachments/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  applyMention,
  detectMentionTrigger,
  filterMentionCandidates,
  type MentionTrigger,
} from "./mention-autocomplete";
import type { MentionTarget } from "./types";

export interface CommentComposerProps {
  /** Optional context line (e.g. "Commenting on auth box"). */
  contextLabel?: string | null;
  members: MentionTarget[];
  onSubmit: (body: string) => Promise<void>;
  /** Optional clear-context handler — when present, renders a small "×" next to the context label. */
  onClearContext?: () => void;
}

const MAX_LENGTH = 4000;

/**
 * Inline composer for comments. Supports `@`-trigger autocomplete that
 * resolves against the team's members; on submit it just sends the raw
 * body — the server parses mentions out of it before storing the row.
 */
export function CommentComposer({
  contextLabel,
  members,
  onSubmit,
  onClearContext,
}: CommentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const candidates = trigger
    ? filterMentionCandidates(members, trigger.prefix)
    : [];
  const showPopover = trigger !== null && candidates.length > 0;

  // Keep the active index in range whenever the candidate list changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((current) =>
      candidates.length === 0
        ? 0
        : Math.min(current, candidates.length - 1),
    );
  }, [candidates.length]);

  const onValueChange = (next: string) => {
    setValue(next);
    setError(null);
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? next.length;
    setTrigger(detectMentionTrigger(next, caret));
  };

  const acceptMention = (username: string) => {
    if (!trigger) return;
    const next = applyMention(value, trigger, username);
    setValue(next.value);
    setTrigger(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  /** Insert text at the cursor; falls back to append if the textarea isn't mounted. */
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setValue((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const caret = start + text.length;
      target.focus();
      target.setSelectionRange(caret, caret);
    });
  };

  const uploadFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of images) {
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadAttachment(fd);
        const safeName = result.name.replace(/[\]\\]/g, "_");
        insertAtCursor(`\n![${safeName}](${result.url})\n`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_LENGTH) {
      setError(`Too long (max ${MAX_LENGTH} chars).`);
      return;
    }
    startTransition(async () => {
      try {
        await onSubmit(trimmed);
        setValue("");
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post comment");
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPopover) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + candidates.length) % candidates.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const target = candidates[activeIndex];
        if (target?.username) {
          event.preventDefault();
          acceptMention(target.username);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="relative flex flex-col gap-2 border-t border-white/5 bg-zinc-950/40 p-3"
      onDragOver={(event) => {
        // Only allow image drops; tell the browser this is a copy target.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        void uploadFiles(Array.from(event.dataTransfer.files));
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

      <Textarea
        ref={textareaRef}
        rows={2}
        value={value}
        placeholder="Leave a comment, @mention a teammate, paste an image…"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        onSelect={() => {
          const el = textareaRef.current;
          if (!el) return;
          setTrigger(detectMentionTrigger(value, el.selectionStart));
        }}
        onPaste={(event) => {
          const items = event.clipboardData?.items;
          if (!items) return;
          const files: File[] = [];
          for (const item of items) {
            if (item.kind === "file") {
              const file = item.getAsFile();
              if (file && file.type.startsWith("image/")) files.push(file);
            }
          }
          if (files.length > 0) {
            event.preventDefault();
            void uploadFiles(files);
          }
        }}
        className="max-h-32 min-h-16 resize-none bg-zinc-900/80 text-sm"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (!event.target.files) return;
          void uploadFiles(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-50"
          aria-label="Attach image"
          title="Attach image (or paste / drop one)"
        >
          {uploading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ImagePlus className="size-3" />
          )}
          {uploading ? "Uploading…" : "Image"}
        </button>
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
          disabled={pending || uploading || !value.trim()}
          className="h-7 px-2.5"
        >
          <Send className="size-3" />
          {pending ? "Posting…" : "Comment"}
        </Button>
      </div>

      {showPopover ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-3 right-3 z-10 mb-2 max-h-48 overflow-auto rounded-md border border-white/10 bg-zinc-950/95 py-1 shadow-lg backdrop-blur"
        >
          {candidates.map((candidate, index) => (
            <li
              key={candidate.userId}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                // mousedown not click — click would blur the textarea first
                // and our re-focus logic gets confused.
                event.preventDefault();
                if (candidate.username) acceptMention(candidate.username);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs",
                index === activeIndex
                  ? "bg-white/10 text-zinc-100"
                  : "text-zinc-300 hover:bg-white/5",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200">
                {(candidate.name[0] ?? "?").toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
                <span className="truncate text-zinc-100">{candidate.name}</span>
                {candidate.username ? (
                  <span className="text-zinc-500">@{candidate.username}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
