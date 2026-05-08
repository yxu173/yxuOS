"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { updateTask } from "@/app/(app)/tasks/actions";
import { RichTextEditor } from "@/components/markdown/rich-text-editor";
import { RichTextRender } from "@/components/markdown/rich-text-render";
import { Button } from "@/components/ui/button";
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
  /**
   * Project slug used by the description's `@board` mention picker
   * (boards from this project rise to the top of the suggestion list)
   * and by the read-only renderer to turn mention chips into links.
   * Required — every task lives inside a project.
   */
  projectSlug: string;
}

/**
 * Mode-switching task description: renders the saved markdown as prose
 * by default, switches to a full markdown editor (with paste / drop /
 * button image upload) when clicked. Click outside or hit "Save" to
 * commit; "Cancel" reverts.
 */
export function InlineTaskDescription({
  taskId,
  initialValue,
  projectSlug,
}: InlineTaskDescriptionProps) {
  const [value, setValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastSavedRef = useRef(initialValue);

  // Sync local optimistic value to whatever the server just shipped.
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(initialValue);
      lastSavedRef.current = initialValue;
    }
  }, [initialValue, editing]);

  const save = () => {
    if (value === lastSavedRef.current) {
      setEditing(false);
      return;
    }
    const next = value.trim() || null;
    startTransition(async () => {
      try {
        await updateTask({ taskId, description: next });
        lastSavedRef.current = value;
        setEditing(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save description");
      }
    });
  };

  const cancel = () => {
    setValue(lastSavedRef.current);
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex flex-col gap-2"
        onKeyDownCapture={(event) => {
          // Save / cancel shortcuts at the wrapper level — TipTap's
          // editor would otherwise eat ⌘⏎ for its own purposes.
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      >
        <RichTextEditor
          value={value}
          onChange={setValue}
          autoFocus
          placeholder="Acceptance criteria, links, paste a screenshot, @ a board…"
          boardMentions={{ projectSlug }}
        />
        <div className="flex items-center justify-end gap-2">
          <span className="text-[10px] text-zinc-500">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
              ⌘
            </kbd>{" "}
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
              ⏎
            </kbd>{" "}
            to save · Esc to cancel
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  const hasContent = value.trim().length > 0;

  return (
    <div className="group relative flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "min-h-12 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.03]",
          !hasContent && "text-zinc-500",
        )}
        aria-label="Edit description"
      >
        {hasContent ? (
          <RichTextRender
            body={value}
            linkBoardMentions={{ projectSlug }}
          />
        ) : (
          <p className="text-sm">
            Add a description — formatting, pasted images, and{" "}
            <span className="text-zinc-300">@board</span> mentions are
            supported.
          </p>
        )}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setEditing(true)}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Edit description"
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}
