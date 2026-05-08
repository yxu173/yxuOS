"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Search-result row the popover renders. Mirrors a subset of the
 * `/api/mentions/boards` response — keep this lean so we never
 * over-fetch on every keystroke.
 */
export interface BoardMentionItem {
  id: string;
  name: string;
  projectName?: string | null;
  folderName?: string | null;
  isEmpty?: boolean;
}

export interface BoardMentionListHandle {
  /**
   * Called from the Mention extension's `onKeyDown` so arrow keys /
   * Enter / Tab navigate the list while focus stays in the editor.
   * Returning `true` swallows the key for ProseMirror.
   */
  onKeyDown: (event: { event: KeyboardEvent }) => boolean;
}

export interface BoardMentionListProps {
  items: BoardMentionItem[];
  loading?: boolean;
  /**
   * Selecting a row hands `{ id, label }` back to the Mention
   * extension via its `command` callback (wired up in
   * `board-mention-extension.ts`).
   */
  command: (attrs: { id: string; label: string }) => void;
  /** Set when the user has already mentioned the cap (3) of boards. */
  capReached?: boolean;
  /** Already-selected ids, dimmed in the list to discourage dupes. */
  selectedIds?: string[];
}

/**
 * Suggestion popover rendered next to the caret while the user is
 * typing `@…` in the design-chat composer. Imperatively imperatively
 * navigated via `BoardMentionListHandle.onKeyDown` so keyboard
 * focus never leaves the editor.
 */
export const BoardMentionList = forwardRef<
  BoardMentionListHandle,
  BoardMentionListProps
>(function BoardMentionList(
  { items, loading, command, capReached, selectedIds },
  ref,
) {
  const [highlight, setHighlight] = useState(0);

  // Reset highlight whenever the result set changes — keeps the row
  // pointer pinned to the top of fresh data instead of off the end.
  useEffect(() => {
    setHighlight(0);
  }, [items]);

  const select = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (selectedIds?.includes(item.id)) return; // already mentioned
    if (capReached) return;
    command({ id: item.id, label: item.name });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setHighlight((h) => (items.length === 0 ? 0 : (h + 1) % items.length));
        return true;
      }
      if (event.key === "ArrowUp") {
        setHighlight((h) =>
          items.length === 0 ? 0 : (h - 1 + items.length) % items.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        select(highlight);
        return true;
      }
      // Escape is left for the extension's default handler — closes
      // the popover without inserting.
      return false;
    },
  }));

  return (
    <div
      className={cn(
        "z-50 max-h-72 w-72 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl",
        "text-zinc-200",
      )}
    >
      {capReached ? (
        <div className="px-3 py-2 text-[11px] text-amber-300">
          Up to 3 boards per message — remove one to add another.
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">Searching…</div>
      ) : null}
      {!loading && items.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">
          No boards match.
        </div>
      ) : null}
      {items.map((item, index) => {
        const already = selectedIds?.includes(item.id);
        const subtitleParts: string[] = [];
        if (item.projectName) subtitleParts.push(item.projectName);
        if (item.folderName) subtitleParts.push(item.folderName);
        if (item.isEmpty) subtitleParts.push("empty");
        return (
          <button
            key={item.id}
            type="button"
            // PointerDown not click — by the time `click` fires the
            // editor has already lost selection state and tiptap's
            // command misbehaves.
            onPointerDown={(event) => {
              event.preventDefault();
              select(index);
            }}
            onMouseEnter={() => setHighlight(index)}
            disabled={already || capReached}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded-sm px-2.5 py-1.5 text-left transition-colors",
              index === highlight && !already
                ? "bg-white/10"
                : "hover:bg-white/5",
              already && "cursor-not-allowed opacity-40",
            )}
          >
            <span className="truncate text-xs font-medium text-zinc-100">
              {item.name}
            </span>
            {subtitleParts.length > 0 ? (
              <span className="truncate text-[10px] text-zinc-500">
                {subtitleParts.join(" · ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
});
