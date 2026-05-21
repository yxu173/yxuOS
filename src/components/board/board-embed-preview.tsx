"use client";

import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const ReadonlyExcalidrawCanvas = dynamic(
  () =>
    import("./excalidraw/readonly-excalidraw-canvas").then(
      (mod) => mod.ReadonlyExcalidrawCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        Loading preview…
      </div>
    ),
  },
);

export interface BoardEmbedPreviewProps {
  boardId: string;
  /** Full URL to the board page (e.g. `/p/proj/boards/abc`). */
  boardHref: string;
  /** Board name for the link label. */
  boardName?: string;
  className?: string;
}

/**
 * Inline preview card for a board. Loads the latest snapshot and renders
 * a read-only mini Excalidraw view. Clicking the card opens the board in
 * a new tab.
 *
 * Used by research notes and designs when they reference a board via
 * `[board:boardId]` syntax or @-mentions.
 */
export function BoardEmbedPreview({
  boardId,
  boardHref,
  boardName,
  className,
}: BoardEmbedPreviewProps) {
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(
    null,
  );
  const [name, setName] = useState(boardName ?? "Board");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Load latest snapshot via the latest version
        const versions = await import(
          "@/app/(app)/boards/actions"
        ).then((m) => m.listBoardVersions(boardId));
        if (cancelled) return;
        if (versions.length > 0) {
          const details = await import(
            "@/app/(app)/boards/actions"
          ).then((m) => m.getBoardVersion(versions[0].id));
          if (!cancelled) {
            setSnapshot(details.snapshot);
            setName(boardName ?? "Board");
          }
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [boardId, boardName]);

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-white/5 p-3 text-sm text-zinc-500",
          className,
        )}
      >
        <ExternalLink className="size-3.5" />
        Board unavailable
      </div>
    );
  }

  return (
    <Link
      href={boardHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block overflow-hidden rounded-lg border border-white/5 bg-zinc-900/50 transition-colors hover:border-white/10",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <div className="flex-1 truncate text-xs font-medium text-zinc-300">
          {name}
        </div>
        <ExternalLink className="size-3 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
      </div>

      {/* Mini canvas preview */}
      <div className="h-40 overflow-hidden">
        {snapshot ? (
          <ReadonlyExcalidrawCanvas snapshot={snapshot} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Loading…
          </div>
        )}
      </div>
    </Link>
  );
}
