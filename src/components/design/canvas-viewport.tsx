"use client";

import { useEffect, useRef, useState } from "react";

import { ArtboardView } from "./artboard-view";
import { CanvasToolbar } from "./canvas-toolbar";
import { useDesignCanvas } from "./canvas-store";
import { SelectionOverlay } from "./selection-overlay";

const PAN_BUTTON = 0; // primary mouse button
const ZOOM_INTENSITY = 0.0015;
const TRACKPAD_PAN_SCALE = 1; // wheel deltas already in CSS px

type DragState =
  | { kind: "pan"; startMouse: { x: number; y: number }; startCamera: { x: number; y: number } }
  | {
      kind: "artboard";
      ids: string[];
      startMouse: { x: number; y: number };
      startPositions: Record<string, { x: number; y: number }>;
    };

/**
 * The custom design canvas.
 *
 * - Pan: drag empty space.
 * - Zoom: wheel (anchored at cursor) or pinch-zoom.
 * - Trackpad two-finger swipe: pans (treated as deltaX/deltaY without ctrlKey).
 * - Select: click an artboard. Click empty to clear.
 * - Drag artboard: pointer-down on an artboard moves it.
 *
 * Math:
 * - World point → screen: `screen = world * zoom + camera`.
 * - Screen point → world: `world = (screen - camera) / zoom`.
 */
export function CanvasViewport() {
  const camera = useDesignCanvas((state) => state.camera);
  const artboards = useDesignCanvas((state) => state.artboards);
  const setCamera = useDesignCanvas((state) => state.setCamera);
  const zoomAt = useDesignCanvas((state) => state.zoomAt);
  const panBy = useDesignCanvas((state) => state.panBy);
  const selectOnly = useDesignCanvas((state) => state.selectOnly);
  const clearSelection = useDesignCanvas((state) => state.clearSelection);
  const updateArtboard = useDesignCanvas((state) => state.updateArtboard);
  const removeArtboard = useDesignCanvas((state) => state.removeArtboard);
  const selection = useDesignCanvas((state) => state.selection);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Wheel: zoom on ctrl/meta (pinch on Mac trackpad), pan otherwise.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        // Pinch-zoom on trackpads or ⌘+scroll.
        const factor = Math.exp(-event.deltaY * ZOOM_INTENSITY);
        zoomAt(screenX, screenY, factor);
      } else {
        // Two-finger trackpad pan, or shift-scroll horizontal.
        panBy(-event.deltaX * TRACKPAD_PAN_SCALE, -event.deltaY * TRACKPAD_PAN_SCALE);
      }
    };

    // Native listener (passive: false) so we can preventDefault().
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  // Keyboard: Esc → clear selection, Delete/Backspace → remove selected
  // artboards, ⌘0 → fit, ⌘+ / ⌘- → zoom.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Skip when the user is typing in any input/textarea/contenteditable.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        clearSelection();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selection.length > 0
      ) {
        event.preventDefault();
        for (const id of selection) {
          removeArtboard(id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, removeArtboard, selection]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only start a pan on primary button + empty world.
    if (event.button !== PAN_BUTTON) return;
    const target = event.target as HTMLElement;
    // If the pointerdown landed on an artboard, our `onPointerDownArtboard`
    // handler will have already started an artboard drag — don't start a pan.
    if (target.closest("[data-artboard-id]")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    // Clicking empty world space deselects both artboards and nodes.
    clearSelection();
    setIsPanning(true);
    dragRef.current = {
      kind: "pan",
      startMouse: { x: event.clientX, y: event.clientY },
      startCamera: { x: camera.x, y: camera.y },
    };
  };

  const onPointerDownArtboard = (
    event: React.PointerEvent,
    id: string,
  ) => {
    event.stopPropagation();
    if (event.button !== PAN_BUTTON) return;

    selectOnly(id);

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    // Snapshot starting positions for all currently-selected artboards
    // (single-select for now, but ready for shift-multi-select later).
    const ids = [id];
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const artboardId of ids) {
      const artboard = artboards.find((a) => a.id === artboardId);
      if (artboard) {
        startPositions[artboardId] = { x: artboard.x, y: artboard.y };
      }
    }
    dragRef.current = {
      kind: "artboard",
      ids,
      startMouse: { x: event.clientX, y: event.clientY },
      startPositions,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "pan") {
      const dx = event.clientX - drag.startMouse.x;
      const dy = event.clientY - drag.startMouse.y;
      setCamera((prev) => ({
        ...prev,
        x: drag.startCamera.x + dx,
        y: drag.startCamera.y + dy,
      }));
    } else if (drag.kind === "artboard") {
      const dx = (event.clientX - drag.startMouse.x) / camera.zoom;
      const dy = (event.clientY - drag.startMouse.y) / camera.zoom;
      for (const id of drag.ids) {
        const start = drag.startPositions[id];
        if (!start) continue;
        updateArtboard(id, { x: start.x + dx, y: start.y + dy });
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsPanning(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-zinc-900 select-none"
      style={{
        // Subtle dot grid for spatial reference.
        backgroundImage:
          "radial-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        backgroundPosition: `${camera.x % 24}px ${camera.y % 24}px`,
        cursor: isPanning ? "grabbing" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Transformed world — everything inside is in world coordinates. */}
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {artboards.map((artboard) => (
          <ArtboardView
            key={artboard.id}
            artboard={artboard}
            onPointerDownArtboard={onPointerDownArtboard}
          />
        ))}
        <SelectionOverlay />
      </div>

      <CanvasToolbar />
    </div>
  );
}
