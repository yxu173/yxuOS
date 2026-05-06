"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { renameBoard } from "@/app/(app)/boards/actions";
import { cn } from "@/lib/utils";

export interface BoardNameProps {
  boardId: string;
  initialName: string;
}

/**
 * Inline-rename board name. Click the text → it becomes an input.
 * Enter or blur commits via the renameBoard server action; Escape cancels.
 *
 * We hold an optimistic override while the server action runs; once the
 * page revalidates, `initialName` updates and we clear the override.
 */
export function BoardName({ boardId, initialName }: BoardNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayName = optimisticName ?? initialName;

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(displayName);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === displayName) {
      return;
    }
    setOptimisticName(trimmed);
    startTransition(async () => {
      try {
        await renameBoard(boardId, trimmed);
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
        aria-label="Board name"
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
      title="Rename board"
    >
      <span className="truncate">{displayName}</span>
    </button>
  );
}
