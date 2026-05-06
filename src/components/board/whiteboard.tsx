"use client";

import dynamic from "next/dynamic";

import type { TldrawCanvasProps } from "./tldraw-canvas";

/**
 * Tldraw must only run in the browser — it reaches for `window` /
 * `document` at module load. Loading it through `next/dynamic` with
 * `ssr: false` keeps it out of the server bundle entirely.
 */
const TldrawCanvas = dynamic(
  () => import("./tldraw-canvas").then((mod) => mod.TldrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
        Loading whiteboard…
      </div>
    ),
  },
);

export function Whiteboard(props: TldrawCanvasProps) {
  return <TldrawCanvas {...props} />;
}
