"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

import { WorkspaceCard, type WorkspaceItem } from "./workspace-card";

export interface WorkspaceGridItem extends WorkspaceItem {
  createdAt: Date;
}

export interface WorkspaceGridProps {
  items: WorkspaceGridItem[];
  hrefBase: string;
  itemLabel: string;
  itemLabelPlural: string;
  emptyHint?: string;
  renameAction: (id: string, name: string) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}

type SortKey = "updated" | "created" | "name";

export function WorkspaceGrid({
  items,
  hrefBase,
  itemLabel,
  itemLabelPlural,
  emptyHint,
  renameAction,
  deleteAction,
}: WorkspaceGridProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const filtered = trimmed
      ? items.filter((item) => item.name.toLowerCase().includes(trimmed))
      : items.slice();
    filtered.sort((a, b) => {
      switch (sort) {
        case "created":
          return b.createdAt.getTime() - a.createdAt.getTime();
        case "name":
          return a.name.localeCompare(b.name);
        case "updated":
        default:
          return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
    });
    return filtered;
  }, [items, query, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${itemLabelPlural}…`}
            className="pl-8"
            aria-label={`Search ${itemLabelPlural}`}
          />
        </div>
        <ToggleGroup
          type="single"
          value={sort}
          onValueChange={(value) => {
            if (value) setSort(value as SortKey);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="updated">Recent</ToggleGroupItem>
          <ToggleGroupItem value="created">Created</ToggleGroupItem>
          <ToggleGroupItem value="name">A–Z</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visible.length === 0 ? (
        <section className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
          {query.trim() ? (
            <>
              <p>No {itemLabelPlural} match “{query}”.</p>
              <p className="text-xs">Try a different search.</p>
            </>
          ) : (
            <>
              <p>No {itemLabelPlural} yet.</p>
              <p className="text-xs">
                {emptyHint ?? `Hit "New ${itemLabel}" to start.`}
              </p>
            </>
          )}
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <li key={item.id}>
              <WorkspaceCard
                item={item}
                hrefBase={hrefBase}
                itemLabel={itemLabel}
                renameAction={renameAction}
                deleteAction={deleteAction}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
