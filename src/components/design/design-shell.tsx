"use client";

import type { UIMessage } from "ai";
import { useState } from "react";

import { CanvasViewport } from "./canvas-viewport";
import { useDesignCanvas } from "./canvas-store";
import { DesignChat } from "./design-chat";
import type { Artboard } from "./types";
import { useDesignPersistence } from "./use-design-persistence";

export interface DesignShellProps {
  designId: string;
  designName: string;
  initialArtboards: Artboard[];
  initialMessages: UIMessage[];
}

/**
 * Page-level wrapper for the design canvas.
 *
 * Top bar with proper rename / share / panel toggles + left panel for the
 * designs history land in commit 8 (polish). Right panel = design chat is
 * here from commit 6.
 */
export function DesignShell({
  designId,
  designName,
  initialArtboards,
  initialMessages,
}: DesignShellProps) {
  // Lazy initializer: runs once before the first render. Side-effect into
  // the zustand store so CanvasViewport sees the artboards on its very
  // first paint, no flash of empty canvas.
  useState(() => {
    useDesignCanvas.getState().setArtboards(initialArtboards);
    return null;
  });

  // Debounced snapshot save on every artboard mutation; flushes on unmount.
  useDesignPersistence(designId);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/80 px-3 backdrop-blur">
        <span className="text-sm font-medium text-zinc-100">
          {designName}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          design canvas
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex-1 overflow-hidden">
          <CanvasViewport />
        </main>
        <DesignChat designId={designId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
