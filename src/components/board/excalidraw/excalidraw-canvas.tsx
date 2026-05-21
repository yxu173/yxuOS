"use client";

import { Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveBoardSnapshot } from "@/app/(app)/boards/actions";

import {
  useBoardCanvasHandle,
  useBoardSelectionWriter,
  useBoardZoomWriter,
} from "../editor-context";
import { ExcalidrawCardOverlay } from "./card-overlay";
import { buildSnapshot, toInitialData } from "./snapshot";

const SAVE_DEBOUNCE_MS = 1500;

export interface ExcalidrawCanvasProps {
  boardId: string;
  /**
   * Row from `boards.snapshot`. Either an Excalidraw snapshot
   * (`engine: "excalidraw"`, see `./snapshot.ts`) or null for a
   * fresh board, in which case we mount an empty scene.
   *
   * `toInitialData` is defensive about the shape — anything it
   * doesn't recognise as a valid v1 snapshot falls through to
   * empty. That covers the Phase 4 wipe case where every legacy
   * `boards.snapshot` was NULLed out by migration 0018.
   */
  initialSnapshot: Record<string, unknown> | null;
}

/**
 * Excalidraw mount. Responsibilities:
 *
 *   - hands the live API to the React context so the rest of the
 *     board shell (chat, comments, preview overlay) can read the
 *     scene without prop-drilling
 *   - debounced save back to Postgres on real content changes only
 *     (skips camera moves and selection changes)
 *   - flushes pending writes on unmount so navigating away never
 *     drops the last 1.5s of edits
 *   - renders the card overlay layer for markdown / mermaid
 *     "shapes" (which are persisted as rectangles with `customData`)
 *
 * Excalidraw imports CSS at module load (`@excalidraw/excalidraw/index.css`)
 * — the parent `Whiteboard` wraps this in `next/dynamic({ ssr: false })`
 * so the CSS only ships to the client.
 */
export function ExcalidrawCanvas({
  boardId,
  initialSnapshot,
}: ExcalidrawCanvasProps) {
  const setSelectedShapeIds = useBoardSelectionWriter();
  const setCanvasZoom = useBoardZoomWriter();
  const handleRef = useBoardCanvasHandle();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // Refs (not state) so writes don't re-render the canvas: the API
  // holds a stable identity, the timer is a transient, and the
  // version is just a sentinel for the debounced save.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedVersionRef = useRef<number>(-1);
  const latestSceneRef = useRef<{
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  } | null>(null);

  const flush = useCallback(() => {
    const scene = latestSceneRef.current;
    if (!scene) return;
    const snapshot = buildSnapshot(scene.elements, scene.appState, scene.files);
    saveBoardSnapshot(
      boardId,
      snapshot as unknown as Record<string, unknown>,
    ).catch((error) => {
      console.error("Failed to save board:", error);
    });
  }, [boardId]);

  // Park the live API in the shared ref so the chat panel / tool
  // dispatcher can call into the canvas. Cleared on unmount only if
  // no newer canvas has written its handle in the meantime
  // (StrictMode mounts the component twice in dev).
  useEffect(() => {
    if (!api) return;
    handleRef.current = { api };
    return () => {
      if (handleRef.current?.api === api) {
        handleRef.current = null;
      }
    };
  }, [api, handleRef]);

  // On unmount: cancel any pending save, then do one last flush so we
  // never drop the trailing edits to a tab-close or route-change.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        flush();
      }
    };
  }, [flush]);

  // Translate Excalidraw selection state into the engine-neutral
  // shape ids the rest of the app already knows how to consume.
  // Object-key order is preserved by V8, so iterating gives us a
  // deterministic id list.
  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      latestSceneRef.current = { elements, appState, files };

      const version = getSceneVersion(elements);
      if (version !== lastSavedVersionRef.current) {
        lastSavedVersionRef.current = version;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          flush();
        }, SAVE_DEBOUNCE_MS);
      }

      const ids = Object.keys(appState.selectedElementIds ?? {});
      setSelectedShapeIds(ids);

      // Push zoom changes for multiplayer cursors.
      const zoom = appState.zoom?.value ?? 1;
      setCanvasZoom(zoom);
    },
    [flush, setSelectedShapeIds, setCanvasZoom],
  );

  return (
    <div className="absolute inset-0">
      <Excalidraw
        excalidrawAPI={(instance) => setApi(instance)}
        initialData={toInitialData(initialSnapshot)}
        onChange={handleChange}
        theme="dark"
        name="yxuOS Whiteboard"
        UIOptions={{
          // Hide the "Excalidraw" branding and the "Library" button —
          // we don't expose the shared library to users in v1, and
          // the brand badge is a distraction inside our shell.
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: true,
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
