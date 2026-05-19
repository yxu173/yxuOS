"use client";

import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";

import { ArtboardView } from "./artboard-view";
import { CanvasToolbar } from "./canvas-toolbar";
import { useDesignCanvas } from "./canvas-store";
import type { Artboard } from "./types";
import { ensureIds } from "./node-utils";
import { FlowOverlay } from "./flow-overlay";
import { SelectionOverlay } from "./selection-overlay";

const PAN_BUTTON = 0; // primary mouse button
const ZOOM_INTENSITY = 0.0015;
const TRACKPAD_PAN_SCALE = 1; // wheel deltas already in CSS px

/** Snap threshold in *screen* pixels — converted to world via /zoom. */
const SNAP_THRESHOLD_PX = 6;

interface SnapGuide {
  /** "v" vertical line at world X; "h" horizontal at world Y. */
  axis: "v" | "h";
  /** World coordinate of the guide. */
  at: number;
  /** Range to draw across (other axis), in world coords. */
  from: number;
  to: number;
}

type DragState =
  | {
      kind: "pan";
      startMouse: { x: number; y: number };
      startCamera: { x: number; y: number };
    }
  | {
      kind: "artboard";
      ids: string[];
      /** True iff this drag started with Alt/Option held — we'll
       *  duplicate-on-drag (Figma idiom). */
      duplicate: boolean;
      startMouse: { x: number; y: number };
      startPositions: Record<string, { x: number; y: number }>;
      /** When duplicating, the original ids; we drag the clones. */
      cloneOf: Record<string, string>;
    }
  | {
      kind: "marquee";
      startScreen: { x: number; y: number };
      /** "world" rect of the initial click for live-updating selection. */
      startWorld: { x: number; y: number };
    };

/**
 * The custom design canvas.
 *
 * Direct-manipulation gestures:
 *
 * - **Pan**: drag empty space.
 * - **Zoom**: wheel (anchored at cursor) or pinch-zoom.
 * - **Trackpad two-finger swipe**: pans.
 * - **Click empty space**: clears selection, starts marquee box-select.
 * - **Click artboard**: replaces selection with that artboard.
 * - **Shift-click artboard**: toggles in/out of selection (multi-select).
 * - **Drag artboard**: moves all selected together. Pink snap guides
 *   appear when edges/centers line up with siblings.
 * - **Alt-drag artboard**: duplicates and drags the clone (Figma).
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
  const setSelection = useDesignCanvas((state) => state.setSelection);
  const clearSelection = useDesignCanvas((state) => state.clearSelection);
  const updateArtboard = useDesignCanvas((state) => state.updateArtboard);
  const removeArtboard = useDesignCanvas((state) => state.removeArtboard);
  const addArtboard = useDesignCanvas((state) => state.addArtboard);
  const selection = useDesignCanvas((state) => state.selection);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<{
    /** Screen-space, normalized (x ≤ x+w). */
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

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
        const factor = Math.exp(-event.deltaY * ZOOM_INTENSITY);
        zoomAt(screenX, screenY, factor);
      } else {
        panBy(
          -event.deltaX * TRACKPAD_PAN_SCALE,
          -event.deltaY * TRACKPAD_PAN_SCALE,
        );
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  // Keyboard: Esc → clear, Delete/Backspace → remove, Cmd+D → duplicate
  // every selected artboard, Cmd+A → select all artboards.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
        const state = useDesignCanvas.getState();
        for (const id of selection) {
          const ab = state.artboards.find((a) => a.id === id);
          if (ab?.locked) continue; // protect locked artboards
          removeArtboard(id);
        }
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "d" &&
        selection.length > 0
      ) {
        event.preventDefault();
        const state = useDesignCanvas.getState();
        const newIds: string[] = [];
        for (const id of selection) {
          const src = state.artboards.find((a) => a.id === id);
          if (!src) continue;
          const newId = nanoid();
          const clone: Artboard = {
            ...src,
            id: newId,
            name: `${src.name} (copy)`,
            x: src.x + src.w + 80,
            y: src.y,
            design: src.design ? ensureIds(src.design) : null,
            locked: false,
          };
          addArtboard(clone);
          newIds.push(newId);
        }
        if (newIds.length > 0) setSelection(newIds);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        const state = useDesignCanvas.getState();
        setSelection(state.artboards.map((a) => a.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    clearSelection,
    removeArtboard,
    addArtboard,
    setSelection,
    selection,
  ]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== PAN_BUTTON) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-artboard-id]")) return;

    event.currentTarget.setPointerCapture(event.pointerId);

    // Empty-space pointerdown:
    //   shift held → marquee select (Figma convention)
    //   plain     → clear selection + pan (preserves old behavior)
    if (event.shiftKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldX = (screenX - camera.x) / camera.zoom;
      const worldY = (screenY - camera.y) / camera.zoom;
      dragRef.current = {
        kind: "marquee",
        startScreen: { x: screenX, y: screenY },
        startWorld: { x: worldX, y: worldY },
      };
      setMarquee({ x: screenX, y: screenY, w: 0, h: 0 });
    } else {
      clearSelection();
      setIsPanning(true);
      dragRef.current = {
        kind: "pan",
        startMouse: { x: event.clientX, y: event.clientY },
        startCamera: { x: camera.x, y: camera.y },
      };
    }
  };

  const onPointerDownArtboard = (
    event: React.PointerEvent,
    id: string,
  ) => {
    event.stopPropagation();
    if (event.button !== PAN_BUTTON) return;

    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === id);
    const wasSelected = selection.includes(id);

    // Resolve which artboards to drag:
    //   shift+click → toggle into selection; drag whole new selection
    //   click on already-selected → drag all selected
    //   plain click on unselected → replace selection with this one
    let nextSelection: string[];
    if (event.shiftKey) {
      nextSelection = wasSelected
        ? selection.filter((s) => s !== id)
        : [...selection, id];
    } else if (wasSelected) {
      nextSelection = selection.length > 0 ? selection : [id];
    } else {
      nextSelection = [id];
    }
    if (nextSelection.length === 0) {
      clearSelection();
    } else if (nextSelection.length === 1) {
      selectOnly(nextSelection[0]!);
    } else {
      setSelection(nextSelection);
    }

    if (ab?.locked && !event.altKey) {
      // Locked artboards: select but don't drag.
      return;
    }

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    // Alt-drag = duplicate-on-drag. Clone every soon-to-be-dragged
    // artboard before snapshotting their start positions, so the
    // dragged subjects ARE the clones (originals stay put).
    const cloneOf: Record<string, string> = {};
    const draggedIds: string[] = [];
    if (event.altKey) {
      for (const sid of nextSelection) {
        const src = state.artboards.find((a) => a.id === sid);
        if (!src) continue;
        const newId = nanoid();
        cloneOf[newId] = sid;
        addArtboard({
          ...src,
          id: newId,
          name: `${src.name} (copy)`,
          design: src.design ? ensureIds(src.design) : null,
          locked: false,
        });
        draggedIds.push(newId);
      }
      if (draggedIds.length > 0) setSelection(draggedIds);
    } else {
      draggedIds.push(...nextSelection);
    }

    const fresh = useDesignCanvas.getState().artboards;
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const sid of draggedIds) {
      const a = fresh.find((b) => b.id === sid);
      if (a) startPositions[sid] = { x: a.x, y: a.y };
    }
    dragRef.current = {
      kind: "artboard",
      ids: draggedIds,
      duplicate: event.altKey,
      startMouse: { x: event.clientX, y: event.clientY },
      startPositions,
      cloneOf,
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
      return;
    }

    if (drag.kind === "marquee") {
      const rect = event.currentTarget.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const x = Math.min(drag.startScreen.x, screenX);
      const y = Math.min(drag.startScreen.y, screenY);
      const w = Math.abs(screenX - drag.startScreen.x);
      const h = Math.abs(screenY - drag.startScreen.y);
      setMarquee({ x, y, w, h });

      // Compute world rect; pick every artboard whose bounding box
      // INTERSECTS it (Figma-style — any touch counts).
      const wx = (x - camera.x) / camera.zoom;
      const wy = (y - camera.y) / camera.zoom;
      const ww = w / camera.zoom;
      const wh = h / camera.zoom;
      const hits: string[] = [];
      for (const ab of artboards) {
        if (
          ab.x + ab.w >= wx &&
          ab.x <= wx + ww &&
          ab.y + ab.h >= wy &&
          ab.y <= wy + wh
        ) {
          hits.push(ab.id);
        }
      }
      if (hits.length === 0) clearSelection();
      else if (hits.length === 1) selectOnly(hits[0]!);
      else setSelection(hits);
      return;
    }

    if (drag.kind === "artboard") {
      const rawDx = (event.clientX - drag.startMouse.x) / camera.zoom;
      const rawDy = (event.clientY - drag.startMouse.y) / camera.zoom;

      // Compute snap guides relative to the OTHER artboards
      // (everything not being dragged). For each axis, snap the
      // dragged group's left / center / right (and top / mid / bottom)
      // to any matching coordinate on a non-dragged neighbour, within
      // a screen-px threshold converted to world units.
      const threshold = SNAP_THRESHOLD_PX / camera.zoom;
      const draggedSet = new Set(drag.ids);
      const others = artboards.filter((a) => !draggedSet.has(a.id));

      // Bounding box of the dragged group at the raw offset.
      const draggedRect = draggedBoundingBox(drag, rawDx, rawDy);
      if (!draggedRect) return;

      let snapDx = 0;
      let snapDy = 0;
      let snapXSource: number | null = null;
      let snapYSource: number | null = null;

      const xCandidates = [
        draggedRect.x,
        draggedRect.x + draggedRect.w / 2,
        draggedRect.x + draggedRect.w,
      ];
      const yCandidates = [
        draggedRect.y,
        draggedRect.y + draggedRect.h / 2,
        draggedRect.y + draggedRect.h,
      ];

      let bestDx = Infinity;
      for (const cand of xCandidates) {
        for (const o of others) {
          for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
            const d = ox - cand;
            if (Math.abs(d) < Math.abs(bestDx) && Math.abs(d) < threshold) {
              bestDx = d;
              snapXSource = ox;
            }
          }
        }
      }
      if (Number.isFinite(bestDx)) snapDx = bestDx;

      let bestDy = Infinity;
      for (const cand of yCandidates) {
        for (const o of others) {
          for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
            const d = oy - cand;
            if (Math.abs(d) < Math.abs(bestDy) && Math.abs(d) < threshold) {
              bestDy = d;
              snapYSource = oy;
            }
          }
        }
      }
      if (Number.isFinite(bestDy)) snapDy = bestDy;

      const dx = rawDx + snapDx;
      const dy = rawDy + snapDy;

      for (const id of drag.ids) {
        const start = drag.startPositions[id];
        if (!start) continue;
        updateArtboard(id, { x: start.x + dx, y: start.y + dy });
      }

      // Build guides for rendering.
      const guides: SnapGuide[] = [];
      if (snapXSource !== null) {
        const ys = others
          .filter(
            (o) =>
              o.x === snapXSource ||
              o.x + o.w / 2 === snapXSource ||
              o.x + o.w === snapXSource,
          )
          .map((o) => [o.y, o.y + o.h])
          .flat();
        const allYs = [
          draggedRect.y + snapDy,
          draggedRect.y + draggedRect.h + snapDy,
          ...ys,
        ];
        guides.push({
          axis: "v",
          at: snapXSource,
          from: Math.min(...allYs),
          to: Math.max(...allYs),
        });
      }
      if (snapYSource !== null) {
        const xs = others
          .filter(
            (o) =>
              o.y === snapYSource ||
              o.y + o.h / 2 === snapYSource ||
              o.y + o.h === snapYSource,
          )
          .map((o) => [o.x, o.x + o.w])
          .flat();
        const allXs = [
          draggedRect.x + snapDx,
          draggedRect.x + draggedRect.w + snapDx,
          ...xs,
        ];
        guides.push({
          axis: "h",
          at: snapYSource,
          from: Math.min(...allXs),
          to: Math.max(...allXs),
        });
      }
      setSnapGuides(guides);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsPanning(false);
    setMarquee(null);
    setSnapGuides([]);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-zinc-900 select-none"
      style={{
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
        <FlowOverlay />
        <SelectionOverlay />
        {/* Snap guides — drawn in WORLD space so the line follows
            the scaling of the canvas. */}
        {snapGuides.length > 0 ? (
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            style={{ width: 0, height: 0 }}
          >
            {snapGuides.map((g, i) => (
              <line
                key={i}
                x1={g.axis === "v" ? g.at : g.from}
                x2={g.axis === "v" ? g.at : g.to}
                y1={g.axis === "h" ? g.at : g.from}
                y2={g.axis === "h" ? g.at : g.to}
                stroke="#ec4899"
                strokeWidth={1 / camera.zoom}
                strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
              />
            ))}
          </svg>
        ) : null}
      </div>

      {/* Marquee box — screen-space, drawn AFTER the world transform
          so it stays a constant 1-px stroke regardless of zoom. */}
      {marquee && (marquee.w > 1 || marquee.h > 1) ? (
        <div
          className="pointer-events-none absolute border border-blue-400/70 bg-blue-400/10"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
          }}
        />
      ) : null}

      <CanvasToolbar />
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────── */

function draggedBoundingBox(
  drag: Extract<DragState, { kind: "artboard" }>,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } | null {
  // We need the dragged artboards' current dimensions. Read fresh from
  // the store so the box reflects width/height (we only have start
  // positions in `drag.startPositions`).
  const state = useDesignCanvas.getState();
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const id of drag.ids) {
    const start = drag.startPositions[id];
    if (!start) continue;
    const ab = state.artboards.find((a) => a.id === id);
    if (!ab) continue;
    rects.push({ x: start.x + dx, y: start.y + dy, w: ab.w, h: ab.h });
  }
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}
