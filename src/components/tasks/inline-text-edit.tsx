"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { updateTask } from "@/app/(app)/tasks/actions";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface InlineTaskTitleProps {
  taskId: string;
  initialValue: string;
}

/**
 * Inline-editable task title. Click to edit, Enter or blur to commit,
 * Escape to revert. Hosted as a borderless input that styles up to the
 * surrounding heading typography so the page doesn't visually shift on
 * focus.
 */
export function InlineTaskTitle({
  taskId,
  initialValue,
}: InlineTaskTitleProps) {
  const [value, setValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync if a parent revalidation ships a new initial value while we're
  // not editing. setState-in-effect is the standard prop-mirror pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setValue(initialValue);
  }, [initialValue, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialValue.trim()) {
      setValue(initialValue);
      return;
    }
    startTransition(async () => {
      try {
        await updateTask({ taskId, title: trimmed });
      } catch (err) {
        setValue(initialValue);
        alert(err instanceof Error ? err.message : "Failed to rename task");
      }
    });
  };

  return editing ? (
    <input
      ref={inputRef}
      defaultValue={value}
      autoFocus
      maxLength={200}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setValue(initialValue);
          setEditing(false);
        }
      }}
      onBlur={commit}
      className="w-full rounded bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight text-zinc-100 outline-none ring-1 ring-white/10 focus:ring-zinc-300/40"
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full rounded px-1 py-0.5 text-left text-2xl font-semibold tracking-tight text-zinc-100 transition-colors hover:bg-white/[0.04]",
        pending && "opacity-70",
      )}
    >
      {value}
    </button>
  );
}

export interface InlineTaskDescriptionProps {
  taskId: string;
  initialValue: string;
}

/**
 * Inline-editable description. Always visible as a textarea — minimal
 * chrome until focus, autosave on blur with optimistic local state.
 */
export function InlineTaskDescription({
  taskId,
  initialValue,
}: InlineTaskDescriptionProps) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const lastSavedRef = useRef(initialValue);

  // Sync local optimistic value to whatever the server just shipped.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(initialValue);
    lastSavedRef.current = initialValue;
  }, [initialValue]);

  const save = () => {
    if (value === lastSavedRef.current) return;
    const next = value.trim() || null;
    startTransition(async () => {
      try {
        await updateTask({ taskId, description: next });
        lastSavedRef.current = value;
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save description");
      }
    });
  };

  return (
    <Textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      placeholder="Add a description, acceptance criteria, links…"
      rows={4}
      className={cn(
        "min-h-24 max-h-[60vh] resize-none border-transparent bg-transparent px-1 py-1 text-sm leading-relaxed text-zinc-200 shadow-none focus-visible:border-white/10 focus-visible:ring-0",
        pending && "opacity-70",
      )}
    />
  );
}
