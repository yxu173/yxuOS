"use client";

import { useState } from "react";

import { CanvasViewport } from "./canvas-viewport";
import { useDesignCanvas } from "./canvas-store";
import type { Artboard } from "./types";

export interface DesignShellProps {
  designId: string;
  designName: string;
  initialArtboards: Artboard[];
}

/**
 * Page-level wrapper for the design canvas.
 *
 * The store is hydrated *during* the first render via a `useState` lazy
 * initializer so the viewport never paints with an empty list. Top bar /
 * left history panel / right chat panel land in commit 6.
 */
export function DesignShell({
  designName,
  initialArtboards,
}: DesignShellProps) {
  // Lazy initializer: runs once before the first render. Side-effect into
  // the zustand store so CanvasViewport sees the artboards on its very
  // first paint, no flash of empty canvas.
  useState(() => {
    useDesignCanvas.getState().setArtboards(initialArtboards);
    return null;
  });

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
      <main className="relative flex-1">
        <CanvasViewport />
      </main>
    </div>
  );
}
