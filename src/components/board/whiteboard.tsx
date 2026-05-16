"use client";

import dynamic from "next/dynamic";

import type { ExcalidrawCanvasProps } from "./excalidraw/excalidraw-canvas";

/**
 * The visible canvas. We dynamic-import Excalidraw with
 * `ssr: false` because the package reads `window` / `document` at
 * module load (it ships as a React component with a sizeable CSS
 * bundle), so importing it server-side would crash the build.
 *
 * Phase 4 of the migration plan dropped tldraw entirely — this used
 * to be a runtime engine selector. If you need a record of what the
 * tldraw mount looked like, check git history before the Phase 4
 * commit. There's no engine flag and no per-board `engine` column
 * any more; every board renders on Excalidraw, full stop.
 */
const ExcalidrawCanvas = dynamic(
  () =>
    import("./excalidraw/excalidraw-canvas").then(
      (mod) => mod.ExcalidrawCanvas,
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

export type WhiteboardProps = ExcalidrawCanvasProps;

export function Whiteboard(props: WhiteboardProps) {
  return <ExcalidrawCanvas {...props} />;
}
