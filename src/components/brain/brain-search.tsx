"use client";

import {
  CheckSquare,
  ClipboardList,
  Code2,
  FileText,
  Layers,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Palette,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BrainSearchItem,
  BrainSearchResponse,
} from "@/app/api/brain/search/route";
import type { KnowledgeKind } from "@/db/schema/project-knowledge";
import { cn } from "@/lib/utils";

/**
 * Client search surface for the project brain.
 *
 * One controlled input plus a kind filter strip. Every keystroke
 * triggers a debounced fetch to `/api/brain/search` for the active
 * project. With an empty query the route returns a recency listing
 * (de-duplicated per artifact) so the page feels alive even before
 * the user types.
 *
 * Permission contract is upstream: the API route resolves
 * `projectSlug` and verifies team ownership. This component just
 * passes the slug through.
 */

interface KindMeta {
  label: string;
  icon: LucideIcon;
  accent: string;
}

const KIND_META: Partial<Record<KnowledgeKind, KindMeta>> = {
  research_note: {
    label: "Research",
    icon: FileText,
    accent: "text-emerald-400",
  },
  task_plan: { label: "Plan", icon: ClipboardList, accent: "text-amber-400" },
  task_plan_row: {
    label: "Plan row",
    icon: ClipboardList,
    accent: "text-amber-400/70",
  },
  task: { label: "Task", icon: CheckSquare, accent: "text-zinc-200" },
  board: { label: "Board", icon: LayoutGrid, accent: "text-zinc-300" },
  design: { label: "Design", icon: Palette, accent: "text-fuchsia-400" },
  design_chat: {
    label: "Design chat",
    icon: MessageSquare,
    accent: "text-fuchsia-300/80",
  },
  comment: {
    label: "Comment",
    icon: MessageSquare,
    accent: "text-zinc-400",
  },
  repo_file: {
    label: "Code",
    icon: Code2,
    accent: "text-sky-400",
  },
};

// The order the filter pills are rendered in. Matters for muscle
// memory; "everything I might be looking for" goes left.
const FILTER_KINDS: KnowledgeKind[] = [
  "research_note",
  "task_plan",
  "task",
  "board",
  "design",
  "repo_file",
  "comment",
];

export function BrainSearch({ projectSlug }: { projectSlug: string }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<BrainSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [embeddingsDisabled, setEmbeddingsDisabled] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<KnowledgeKind>>(
    () => new Set(),
  );

  // Anti-stale-response: track the most recent in-flight request id
  // so a slower older response doesn't overwrite a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(
          "/api/brain/search",
          window.location.origin,
        );
        url.searchParams.set("projectSlug", projectSlug);
        if (query.trim()) url.searchParams.set("q", query.trim());
        if (activeKinds.size > 0) {
          url.searchParams.set(
            "kinds",
            Array.from(activeKinds).join(","),
          );
        }
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
        const json = (await res.json()) as BrainSearchResponse;
        if (requestIdRef.current === id) {
          setItems(json.items);
          setEmbeddingsDisabled(json.embeddingsDisabled);
          setEmpty(json.empty);
          setLoading(false);
        }
      } catch {
        if (requestIdRef.current === id) {
          setItems([]);
          setLoading(false);
        }
      }
      // Match the Cmd+K debounce so the two surfaces feel the same.
    }, 200);
    return () => clearTimeout(handle);
  }, [query, activeKinds, projectSlug]);

  const toggleKind = (kind: KnowledgeKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const grouped = useMemo(() => groupByKind(items), [items]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search input row. The Sparkles icon is the brain affordance —
          this is semantic, not keyword. */}
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-zinc-950/60 px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-emerald-400" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask the brain — 'what auth provider did we pick?', 'tasks blocking launch'…"
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-zinc-500" />
        ) : (
          <Search className="size-3.5 text-zinc-600" />
        )}
      </div>

      {/* Kind filter pills. Click toggles; no active = all kinds. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_KINDS.map((kind) => {
          const meta = KIND_META[kind];
          if (!meta) return null;
          const active = activeKinds.has(kind);
          const Icon = meta.icon;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                active
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : "border-white/10 bg-zinc-900/50 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
              )}
            >
              <Icon className="size-3" />
              {meta.label}
            </button>
          );
        })}
        {activeKinds.size > 0 ? (
          <button
            type="button"
            onClick={() => setActiveKinds(new Set())}
            className="ml-1 text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            clear
          </button>
        ) : null}
      </div>

      {/* Header banner for the empty / disabled / no-results states.
          Kept here (not inside the results list) so it survives
          across debounced refreshes. */}
      {embeddingsDisabled ? (
        <DisabledBanner />
      ) : empty && items.length === 0 ? (
        <FreshBanner />
      ) : items.length === 0 && !loading && query.length > 0 ? (
        <EmptyResultsBanner />
      ) : null}

      {/* Results, grouped by kind. Section order matches FILTER_KINDS
          so the brain reads top-down in the same order users scan
          the filters. */}
      <div className="flex flex-col gap-5">
        {grouped.map(({ kind, rows }) => {
          const meta = KIND_META[kind];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <section key={kind} className="flex flex-col gap-2">
              <header className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                <Icon className={cn("size-3", meta.accent)} />
                <span>{meta.label}</span>
                <span className="text-zinc-700">·</span>
                <span>{rows.length}</span>
              </header>
              <ul className="flex flex-col gap-1.5">
                {rows.map((item) => (
                  <BrainHitRow key={item.id} item={item} meta={meta} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ─── one result row ──────────────────────────────── */

function BrainHitRow({
  item,
  meta,
}: {
  item: BrainSearchItem;
  meta: KindMeta;
}) {
  const Icon = meta.icon;
  const body = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5 shrink-0", meta.accent)} />
        <span className="truncate text-sm font-medium text-zinc-200">
          {item.title?.trim() || meta.label}
        </span>
        {item.similarity !== null ? (
          <span
            className={cn(
              "ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]",
              item.similarity > 0.6
                ? "bg-emerald-400/10 text-emerald-300"
                : item.similarity > 0.4
                  ? "bg-amber-400/10 text-amber-300"
                  : "bg-white/5 text-zinc-400",
            )}
            title={`Cosine similarity ${item.similarity.toFixed(3)}`}
          >
            {item.similarity.toFixed(2)}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 text-xs text-zinc-400">{item.excerpt}</p>
    </div>
  );

  const className =
    "block rounded-md border border-white/5 bg-zinc-950/40 px-3 py-2 transition hover:border-white/15 hover:bg-zinc-900/60";

  if (item.href) {
    return (
      <li>
        <Link href={item.href} className={className}>
          {body}
        </Link>
      </li>
    );
  }
  // Some kinds (comments) don't have a standalone surface yet.
  // Render the row but without the link so the user still sees
  // the hit.
  return (
    <li>
      <div className={cn(className, "cursor-default opacity-80")}>{body}</div>
    </li>
  );
}

/* ─── banners ─────────────────────────────────────── */

function DisabledBanner() {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
      <strong className="font-medium">Embeddings disabled.</strong>{" "}
      Set either the Azure pair
      <code className="mx-1 rounded bg-black/40 px-1 py-0.5 font-mono">
        AZURE_EMBEDDINGS_ENDPOINT
      </code>
      +
      <code className="mx-1 rounded bg-black/40 px-1 py-0.5 font-mono">
        AZURE_EMBEDDINGS_API_KEY
      </code>{" "}
      or
      <code className="mx-1 rounded bg-black/40 px-1 py-0.5 font-mono">
        OPENAI_API_KEY
      </code>
      in your environment, then run{" "}
      <code className="mx-1 rounded bg-black/40 px-1 py-0.5 font-mono">
        bun scripts/rag-backfill.ts
      </code>{" "}
      to index existing content.
    </div>
  );
}

function FreshBanner() {
  return (
    <div className="rounded-md border border-white/5 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-500">
      <Layers className="mx-auto mb-2 size-5 opacity-50" />
      <p>
        Nothing indexed in this project yet. Create a research note, plan,
        task, board, or design — the brain learns automatically.
      </p>
    </div>
  );
}

function EmptyResultsBanner() {
  return (
    <div className="rounded-md border border-white/5 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
      No matches. Try rephrasing as a natural question — semantic search
      doesn&apos;t need exact keywords.
    </div>
  );
}

/* ─── grouping ────────────────────────────────────── */

function groupByKind(
  items: BrainSearchItem[],
): { kind: KnowledgeKind; rows: BrainSearchItem[] }[] {
  // Preserve global ranking within each kind. Outer order follows
  // `FILTER_KINDS` so the layout matches the filter strip.
  const buckets = new Map<KnowledgeKind, BrainSearchItem[]>();
  for (const item of items) {
    const arr = buckets.get(item.sourceType);
    if (arr) arr.push(item);
    else buckets.set(item.sourceType, [item]);
  }
  const out: { kind: KnowledgeKind; rows: BrainSearchItem[] }[] = [];
  for (const kind of FILTER_KINDS) {
    const rows = buckets.get(kind);
    if (rows && rows.length > 0) out.push({ kind, rows });
  }
  // Tail: any kind not in FILTER_KINDS (e.g. task_plan_row, design_chat)
  // ends up here, after the main sections.
  for (const [kind, rows] of buckets.entries()) {
    if (!FILTER_KINDS.includes(kind)) {
      out.push({ kind, rows });
    }
  }
  return out;
}
