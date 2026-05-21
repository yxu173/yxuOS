"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { renameDesign } from "@/app/(app)/designs/actions";
import { cn } from "@/lib/utils";

export interface DesignNameProps {
  designId: string;
  initialName: string;
  /** Streamed title from the server — takes precedence over initialName. */
  streamedTitle?: string | null;
}

/**
 * Inline-rename design name in the top bar. Same UX as <BoardName> for
 * boards: click → input, Enter / blur commits, Escape cancels. Optimistic
 * override stays visible while the server action runs.
 */
export function DesignName({ designId, initialName, streamedTitle }: DesignNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayName = optimisticName ?? streamedTitle ?? initialName;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(displayName);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === displayName) return;
    setOptimisticName(trimmed);
    startTransition(async () => {
      try {
        await renameDesign(designId, trimmed);
        setOptimisticName(null);
      } catch {
        setOptimisticName(null);
      }
    });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        defaultValue={displayName}
        autoFocus
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(displayName);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className="rounded bg-white/5 px-1.5 py-0.5 text-sm font-medium text-zinc-100 outline-none ring-1 ring-white/10 focus:ring-zinc-300/40"
        aria-label="Design name"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        "rounded px-1.5 py-0.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/5",
        pending && "opacity-70",
      )}
      title="Rename design"
    >
      <span className="truncate">{displayName}</span>
    </button>
  );
}
