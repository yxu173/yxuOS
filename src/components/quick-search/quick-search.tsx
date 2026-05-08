"use client";

import {
  CheckSquare,
  ClipboardList,
  Command as CommandIcon,
  FileText,
  LayoutGrid,
  Loader2,
  Palette,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { QuickSearchItem } from "@/app/api/quick-search/route";
import { cn } from "@/lib/utils";

/**
 * Launcher kind metadata: icon, accent colour, section label.
 *
 * Order in this map drives the section order in the dropdown (tasks
 * first, then research / plans, then visual surfaces). Tweaking the
 * order here is the only knob you need to reshuffle the launcher.
 */
const KIND_META: Record<
  QuickSearchItem["kind"],
  { label: string; icon: LucideIcon; accent: string }
> = {
  task: {
    label: "Tasks",
    icon: CheckSquare,
    accent: "text-zinc-200",
  },
  research: {
    label: "Research",
    icon: FileText,
    accent: "text-emerald-400",
  },
  plan: {
    label: "Plans",
    icon: ClipboardList,
    accent: "text-amber-400",
  },
  board: {
    label: "Boards",
    icon: LayoutGrid,
    accent: "text-zinc-300",
  },
  design: {
    label: "Designs",
    icon: Palette,
    accent: "text-fuchsia-400",
  },
};

const KIND_ORDER: ReadonlyArray<QuickSearchItem["kind"]> = [
  "task",
  "research",
  "plan",
  "board",
  "design",
];

/**
 * Global Cmd+K (Ctrl+K) launcher.
 *
 * Mounted once at the app root (`<AppShell>` / layout) so every page
 * inherits the keyboard shortcut. State is fully local — the launcher
 * doesn't share data with the surrounding page; it queries
 * `/api/quick-search` on demand.
 *
 * Open / close:
 *   - `⌘K` / `Ctrl+K` → toggles open from anywhere.
 *   - `Esc` → closes.
 *   - Click outside the panel or on the close button → closes.
 *
 * Keyboard navigation while open:
 *   - `↑` / `↓` → move highlight across the flat result list.
 *   - `Enter` → navigate to highlighted item.
 *   - Typing → re-runs the search (debounced 150ms).
 *
 * The launcher infers the active project from `next/navigation`'s
 * `useParams().projectSlug`, so when the user is on `/p/foo/...` the
 * search boosts items in `foo` to the top. Outside a project surface
 * (e.g. on `/tasks` global), nothing is boosted and we just rank by
 * recency.
 */
export function QuickSearch() {
  const router = useRouter();
  const params = useParams<{ projectSlug?: string }>();
  const projectSlug = params.projectSlug;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<QuickSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Tracks the most recent in-flight search so older responses don't
  // overwrite newer ones if the network is unfair.
  const requestIdRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setHighlight(0);
  }, []);

  // Global shortcut. We attach to the window directly (rather than via
  // a higher-up provider) because the launcher must work no matter
  // what page the user is on — including pages that don't render a
  // top bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isToggle =
        (event.key === "k" || event.key === "K") &&
        (event.metaKey || event.ctrlKey);
      if (isToggle) {
        event.preventDefault();
        // Don't re-fetch if we're already open; the user just wants
        // to dismiss with the same shortcut.
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lift focus into the search input on open, and reset everything
  // on close.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Search whenever the query (or open state) changes. Debounced
  // to avoid blasting the API on every keystroke; 150ms is short
  // enough to feel responsive and long enough to coalesce typing.
  //
  // The "loading" state is flipped on inside the timeout (not
  // synchronously in the effect body) so React 19's purity rule
  // is satisfied and we don't trigger a cascading render before
  // the timer even fires.
  useEffect(() => {
    if (!open) return;
    const id = ++requestIdRef.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(
          "/api/quick-search",
          window.location.origin,
        );
        if (query.trim()) url.searchParams.set("q", query.trim());
        if (projectSlug) url.searchParams.set("projectSlug", projectSlug);
        const res = await fetch(url.toString(), {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (requestIdRef.current === id) {
            setItems([]);
            setLoading(false);
          }
          return;
        }
        const json = (await res.json()) as { items: QuickSearchItem[] };
        if (requestIdRef.current === id) {
          // Materialise dates — JSON serialises them as strings.
          setItems(
            json.items.map((it) => ({
              ...it,
              updatedAt: new Date(it.updatedAt),
            })),
          );
          setHighlight(0);
          setLoading(false);
        }
      } catch {
        if (requestIdRef.current === id) {
          setItems([]);
          setLoading(false);
        }
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open, projectSlug]);

  // Group items by kind, preserving the global rank within each
  // section. We also compute a flat array (in section order) for
  // arrow-key nav.
  const sections = useMemo(() => {
    const buckets = new Map<QuickSearchItem["kind"], QuickSearchItem[]>();
    for (const item of items) {
      const arr = buckets.get(item.kind);
      if (arr) arr.push(item);
      else buckets.set(item.kind, [item]);
    }
    return KIND_ORDER.flatMap((kind) => {
      const rows = buckets.get(kind) ?? [];
      return rows.length > 0 ? [{ kind, rows }] : [];
    });
  }, [items]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const navigate = useCallback(
    (item: QuickSearchItem) => {
      router.push(item.href);
      close();
    },
    [router, close],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) =>
        flat.length === 0 ? 0 : (h + 1) % flat.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) =>
        flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[highlight];
      if (item) navigate(item);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
    >
      {/* Backdrop. Plain black at low opacity — keeps the launcher
          feeling lighter than a full modal. */}
      <button
        type="button"
        aria-label="Close quick search"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
      />

      <div className="relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl">
        {/* Search input row */}
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
          <Search className="size-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, research, plans, boards, designs…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {loading ? (
            <Loader2 className="size-3.5 animate-spin text-zinc-500" />
          ) : null}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Result list */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {flat.length === 0 && !loading ? (
            <EmptyState query={query} />
          ) : (
            (() => {
              // Render with a running flat-index so each row knows
              // which highlight position it lives at.
              let cursor = 0;
              return sections.map(({ kind, rows }) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return (
                  <div key={kind} className="flex flex-col">
                    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      <Icon className={cn("size-3", meta.accent)} />
                      {meta.label}
                      <span className="ml-1 text-zinc-700">{rows.length}</span>
                    </div>
                    {rows.map((item) => {
                      const flatIndex = cursor++;
                      const active = flatIndex === highlight;
                      return (
                        <button
                          key={`${item.kind}:${item.id}`}
                          type="button"
                          onClick={() => navigate(item)}
                          onMouseEnter={() => setHighlight(flatIndex)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                            active ? "bg-white/10" : "hover:bg-white/5",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-3.5 shrink-0",
                              active ? meta.accent : "text-zinc-500",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-zinc-100">
                            {item.title || "(untitled)"}
                          </span>
                          <span className="shrink-0 text-[10px] text-zinc-600">
                            {item.projectName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-600">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">↑↓</kbd>
            navigate
            <kbd className="ml-2 rounded border border-white/10 bg-white/5 px-1 py-0.5">↵</kbd>
            open
            <kbd className="ml-2 rounded border border-white/10 bg-white/5 px-1 py-0.5">esc</kbd>
            dismiss
          </span>
          <span className="inline-flex items-center gap-1">
            <CommandIcon className="size-3" />K
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-3 py-8 text-center">
      <p className="text-xs text-zinc-500">
        {query.trim()
          ? `No matches for "${query.trim()}".`
          : "Type to search across the team."}
      </p>
      {!query.trim() ? (
        <p className="text-[11px] text-zinc-600">
          Tasks, research, plans, boards, and designs are all here.
        </p>
      ) : null}
    </div>
  );
}
