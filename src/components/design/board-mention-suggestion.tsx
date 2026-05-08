"use client";

import { ClipboardList, FileText, LayoutGrid } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Discriminator for the three mention kinds the popover supports.
 * Drives the icon, the section header, and the link href written by
 * `RichTextRender` when the chip becomes a clickable anchor.
 */
export type MentionKind = "board" | "research" | "plan";

/**
 * Search-result row the popover renders. Mirrors a subset of the
 * `/api/mentions/search` response. Kept lean so we never over-fetch
 * on every keystroke.
 *
 * Historical name: "BoardMentionItem". The shape is now general — it
 * carries `kind` and represents any of boards / research notes / plans.
 * The exported alias `MentionItem` is the preferred name in new code.
 */
export interface BoardMentionItem {
  id: string;
  kind: MentionKind;
  name: string;
  projectName?: string | null;
  /** Boards only. */
  folderName?: string | null;
  /**
   * For boards: snapshot is empty.
   * For plans: the plan has been executed (all rows shipped). We
   * surface this so the user can see at a glance which plans are
   * historical vs. live.
   * Unused for research notes.
   */
  isEmpty?: boolean;
}

export type MentionItem = BoardMentionItem;

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
   * Selecting a row hands `{ id, label, kind }` back to the Mention
   * extension via its `command` callback (wired up in
   * `board-mention-extension.ts`). `kind` is required because the
   * mention node stores it as an attr — a research note and a board
   * with the same id (impossible in practice but defensible) must
   * round-trip distinctly.
   */
  command: (attrs: { id: string; label: string; kind: MentionKind }) => void;
  /** Set when the user has already mentioned the cap of items. */
  capReached?: boolean;
  /** Already-selected ids, dimmed in the list to discourage dupes. */
  selectedIds?: string[];
}

/* ─── Kind metadata ───────────────────────────────────── */

const KIND_META: Record<
  MentionKind,
  {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
    iconClass: string;
  }
> = {
  board: {
    label: "Boards",
    icon: LayoutGrid,
    iconClass: "text-zinc-400",
  },
  research: {
    label: "Research",
    icon: FileText,
    iconClass: "text-emerald-400",
  },
  plan: {
    label: "Plans",
    icon: ClipboardList,
    iconClass: "text-amber-400",
  },
};

const KIND_ORDER: readonly MentionKind[] = ["board", "research", "plan"];

/**
 * Suggestion popover rendered next to the caret while the user is
 * typing `@…`. Displays results grouped by kind (Boards / Research /
 * Plans) — each section gets its own header and icon so the user can
 * tell at a glance what they'd be linking to.
 *
 * Imperatively navigated via {@link BoardMentionListHandle.onKeyDown}
 * so keyboard focus never leaves the editor.
 */
export const BoardMentionList = forwardRef<
  BoardMentionListHandle,
  BoardMentionListProps
>(function BoardMentionList(
  { items, loading, command, capReached, selectedIds },
  ref,
) {
  const [highlight, setHighlight] = useState(0);

  // Group items by kind, preserving the global order of items (api
  // already ranks across kinds; we keep within-section order). The
  // popover renders sections in fixed order — board → research →
  // plan — so the same query always produces the same layout.
  const sections = useMemo(() => {
    const buckets = new Map<MentionKind, BoardMentionItem[]>();
    for (const item of items) {
      const kind = item.kind ?? "board";
      const arr = buckets.get(kind);
      if (arr) arr.push(item);
      else buckets.set(kind, [item]);
    }
    return KIND_ORDER.flatMap((kind) => {
      const rows = buckets.get(kind) ?? [];
      return rows.length > 0 ? [{ kind, rows }] : [];
    });
  }, [items]);

  // Flatten sections back into an indexable list for keyboard nav,
  // skipping section headers. Index `i` here maps to a position in
  // `flattened[i]` and that's what `highlight` tracks.
  const flattened = useMemo(
    () => sections.flatMap((s) => s.rows),
    [sections],
  );

  // Reset highlight whenever the result set changes — keeps the row
  // pointer pinned to the top of fresh data instead of off the end.
  useEffect(() => {
    setHighlight(0);
  }, [items]);

  const select = (index: number) => {
    const item = flattened[index];
    if (!item) return;
    if (selectedIds?.includes(item.id)) return; // already mentioned
    if (capReached) return;
    command({ id: item.id, label: item.name, kind: item.kind });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setHighlight((h) =>
          flattened.length === 0 ? 0 : (h + 1) % flattened.length,
        );
        return true;
      }
      if (event.key === "ArrowUp") {
        setHighlight((h) =>
          flattened.length === 0
            ? 0
            : (h - 1 + flattened.length) % flattened.length,
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
        "z-50 max-h-80 w-80 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl",
        "text-zinc-200",
      )}
    >
      {capReached ? (
        <div className="px-3 py-2 text-[11px] text-amber-300">
          Up to 3 mentions per message — remove one to add another.
        </div>
      ) : null}
      {loading && flattened.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">Searching…</div>
      ) : null}
      {!loading && flattened.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">
          No matches across boards, research, or plans.
        </div>
      ) : null}
      {(() => {
        // Walk sections, keeping a running flat-index counter so each
        // row knows its global highlight position.
        let cursor = 0;
        return sections.map(({ kind, rows }) => {
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          const startCursor = cursor;
          const sectionRows = rows.map((item) => {
            const flatIndex = cursor++;
            return { item, flatIndex };
          });
          return (
            <div key={kind} className="flex flex-col">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500",
                  startCursor === 0 ? "pt-1" : undefined,
                )}
              >
                <Icon className={cn("size-3", meta.iconClass)} />
                {meta.label}
                <span className="ml-1 text-zinc-700">{rows.length}</span>
              </div>
              {sectionRows.map(({ item, flatIndex }) => {
                const already = selectedIds?.includes(item.id);
                const subtitleParts: string[] = [];
                if (item.projectName) subtitleParts.push(item.projectName);
                if (item.folderName) subtitleParts.push(item.folderName);
                if (item.isEmpty) {
                  subtitleParts.push(
                    item.kind === "plan" ? "executed" : "empty",
                  );
                }
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    // PointerDown not click — by the time `click`
                    // fires, the editor has already lost selection
                    // state and tiptap's command misbehaves.
                    onPointerDown={(event) => {
                      event.preventDefault();
                      select(flatIndex);
                    }}
                    onMouseEnter={() => setHighlight(flatIndex)}
                    disabled={already || capReached}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-sm px-2.5 py-1.5 text-left transition-colors",
                      flatIndex === highlight && !already
                        ? "bg-white/10"
                        : "hover:bg-white/5",
                      already && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span className="truncate text-xs font-medium text-zinc-100">
                      {item.name || "(untitled)"}
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
      })()}
    </div>
  );
});
