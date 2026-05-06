"use client";

import dynamic from "next/dynamic";

import type { ReadonlyTldrawCanvasProps } from "./readonly-tldraw-canvas";

const ReadonlyTldrawCanvas = dynamic(
  () =>
    import("./readonly-tldraw-canvas").then(
      (mod) => mod.ReadonlyTldrawCanvas,
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

export function ReadonlyWhiteboard(props: ReadonlyTldrawCanvasProps) {
  return <ReadonlyTldrawCanvas {...props} />;
}
