"use client";

import dynamic from "next/dynamic";

import type { ReadonlyExcalidrawCanvasProps } from "./excalidraw/readonly-excalidraw-canvas";

/**
 * Read-only canvas mounted on the public `/share/<token>` page.
 * Excalidraw-only since Phase 4 — see `whiteboard.tsx` for context.
 */
const ReadonlyExcalidrawCanvas = dynamic(
  () =>
    import("./excalidraw/readonly-excalidraw-canvas").then(
      (mod) => mod.ReadonlyExcalidrawCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
        Loading whiteboard…
      </div>
    ),
  },
);

export type ReadonlyWhiteboardProps = ReadonlyExcalidrawCanvasProps;

export function ReadonlyWhiteboard(props: ReadonlyWhiteboardProps) {
  return <ReadonlyExcalidrawCanvas {...props} />;
}
