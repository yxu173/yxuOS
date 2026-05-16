"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useState } from "react";

import { ExcalidrawCardOverlay } from "./card-overlay";
import { toInitialData } from "./snapshot";

export interface ReadonlyExcalidrawCanvasProps {
  snapshot: Record<string, unknown> | null;
}

/**
 * Excalidraw mounted in `viewModeEnabled` — pan / zoom / select work,
 * shape edits and tools are locked down. Used by the public share
 * page where viewers shouldn't be able to mutate the board.
 */
export function ReadonlyExcalidrawCanvas({
  snapshot,
}: ReadonlyExcalidrawCanvasProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  return (
    <div className="absolute inset-0">
      <Excalidraw
        excalidrawAPI={(instance) => setApi(instance)}
        initialData={toInitialData(snapshot)}
        theme="dark"
        viewModeEnabled
        zenModeEnabled
        name="yxuOS Whiteboard"
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
      />
      {api ? <ExcalidrawCardOverlay api={api} /> : null}
    </div>
  );
}
