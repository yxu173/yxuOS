"use client";

import { create } from "zustand";
import { temporal } from "zundo";

import type { DesignNode } from "./design-node";
import {
  deleteNodeInTree,
  ensureIds,
  updateNodeInTree,
} from "./node-utils";
import type { Artboard, Camera } from "./types";

/* ─── Zoom bounds ─── */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

interface DesignCanvasState {
  artboards: Artboard[];
  camera: Camera;
  /** Selected artboard ids (currently single-select but typed as array
   * for future shift-click multi-select). */
  selection: string[];
  /**
   * The currently "active" picked node inside an artboard — drives the
   * inspector panel and serves as the `selectedNodeId` returned by
   * `query_canvas`. Always equal to the LAST id appended to
   * `selectedNodeIds` (or `null` if none).
   */
  selectedNodeId: string | null;
  /**
   * Every picked node, in pick order. Single-click replaces the set;
   * shift-click toggles the clicked id in/out additively. The chat
   * composer reads this to populate its "pinned elements" chip row;
   * the renderer reads it to decide which nodes get the blue ring.
   */
  selectedNodeIds: string[];
  /**
   * Toggle for flow-view: when true, an SVG overlay draws prototype
   * arrows from each `flowTo` source to its target artboard. UI-only
   * state — not in undo history, not persisted.
   */
  flowViewEnabled: boolean;

  /* ─── Camera ────────────────────────────── */
  setCamera: (next: Camera | ((prev: Camera) => Camera)) => void;
  zoomAt: (screenX: number, screenY: number, factor: number) => void;
  panBy: (dx: number, dy: number) => void;

  /* ─── Selection ─────────────────────────── */
  setSelection: (ids: string[]) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;
  /**
   * Pick a node inside an artboard. With `additive: true` (shift-click),
   * toggles the id in/out of `selectedNodeIds`; without it, replaces the
   * set with `[id]`. Passing `null` clears every pick.
   *
   * `selectedNodeId` always tracks the most-recently-added entry of
   * `selectedNodeIds` so single-pick consumers (inspector,
   * `query_canvas`) keep working unchanged.
   */
  selectNode: (id: string | null, additive?: boolean) => void;
  /** Clear every node pick without touching artboard selection. */
  clearNodeSelection: () => void;

  /* ─── Artboards ─────────────────────────── */
  setArtboards: (artboards: Artboard[]) => void;
  addArtboard: (artboard: Artboard) => void;
  updateArtboard: (id: string, patch: Partial<Artboard>) => void;
  updateArtboardDesign: (id: string, design: DesignNode | null) => void;
  removeArtboard: (id: string) => void;

  /* ─── Per-node mutations (inside an artboard) ─── */
  updateNodeInArtboard: (
    artboardId: string,
    nodeId: string,
    patch: Partial<DesignNode>,
  ) => void;
  deleteNodeInArtboard: (artboardId: string, nodeId: string) => void;

  /* ─── Flow-view ──────────────────────────────────── */
  setFlowViewEnabled: (enabled: boolean) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Run `ensureIds` on each artboard's design tree so every node has a
 * stable id. Used as a normaliser at every store entry point.
 */
function normaliseArtboards(artboards: Artboard[]): Artboard[] {
  return artboards.map((a) => ({
    ...a,
    design: a.design ? ensureIds(a.design) : null,
  }));
}

function normaliseArtboard(artboard: Artboard): Artboard {
  return {
    ...artboard,
    design: artboard.design ? ensureIds(artboard.design) : null,
  };
}

/**
 * Pieces of the store that participate in undo/redo. Camera + selection
 * are session-only — undoing a pan or a click would feel wrong, and
 * they'd swamp the history stack. Only the artboard data is tracked.
 */
interface UndoableState {
  artboards: Artboard[];
}

export const useDesignCanvas = create<DesignCanvasState>()(
  temporal(
    (set) => ({
  artboards: [],
  camera: { x: 120, y: 120, zoom: 0.5 },
  selection: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  flowViewEnabled: false,

  setCamera: (next) =>
    set((state) => ({
      camera: typeof next === "function" ? next(state.camera) : next,
    })),

  /**
   * Zoom around a screen-space anchor (the cursor). Math: keep the world
   * point under (screenX, screenY) fixed across the zoom change.
   */
  zoomAt: (screenX, screenY, factor) =>
    set((state) => {
      const { camera } = state;
      const newZoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const realFactor = newZoom / camera.zoom;
      return {
        camera: {
          x: screenX - (screenX - camera.x) * realFactor,
          y: screenY - (screenY - camera.y) * realFactor,
          zoom: newZoom,
        },
      };
    }),

  panBy: (dx, dy) =>
    set((state) => ({
      camera: {
        ...state.camera,
        x: state.camera.x + dx,
        y: state.camera.y + dy,
      },
    })),

  setSelection: (ids) => set({ selection: ids }),
  selectOnly: (id) =>
    set({ selection: [id], selectedNodeId: null, selectedNodeIds: [] }),
  clearSelection: () =>
    set({ selection: [], selectedNodeId: null, selectedNodeIds: [] }),
  /**
   * Single (non-additive) pick replaces the set with `[id]`; additive
   * pick (shift-click) toggles the id in/out. Passing `null`
   * unconditionally clears every pick — used by Esc, the inspector's
   * Deselect button, and post-mutation cleanups.
   *
   * `selectedNodeId` always tracks the LAST entry of `selectedNodeIds`
   * so single-pick consumers (inspector / `query_canvas`) see the
   * "active" element without having to know about the array.
   */
  selectNode: (id, additive = false) =>
    set((state) => {
      if (id === null) {
        return { selectedNodeId: null, selectedNodeIds: [] };
      }
      if (!additive) {
        return { selectedNodeId: id, selectedNodeIds: [id] };
      }
      // Additive: toggle. If already in the set, drop it; otherwise
      // append and make it the active one.
      const idx = state.selectedNodeIds.indexOf(id);
      if (idx >= 0) {
        const nextIds = [
          ...state.selectedNodeIds.slice(0, idx),
          ...state.selectedNodeIds.slice(idx + 1),
        ];
        return {
          selectedNodeIds: nextIds,
          selectedNodeId: nextIds.length > 0 ? nextIds[nextIds.length - 1]! : null,
        };
      }
      const nextIds = [...state.selectedNodeIds, id];
      return { selectedNodeIds: nextIds, selectedNodeId: id };
    }),
  clearNodeSelection: () =>
    set({ selectedNodeId: null, selectedNodeIds: [] }),

  setArtboards: (artboards) => set({ artboards: normaliseArtboards(artboards) }),
  addArtboard: (artboard) =>
    set((state) => ({
      artboards: [...state.artboards, normaliseArtboard(artboard)],
    })),
  updateArtboard: (id, patch) =>
    set((state) => ({
      artboards: state.artboards.map((a) => {
        if (a.id !== id) return a;
        const merged = { ...a, ...patch };
        // If the patch touched the design, normalise ids.
        return patch.design !== undefined ? normaliseArtboard(merged) : merged;
      }),
    })),
  updateArtboardDesign: (id, design) =>
    set((state) => ({
      artboards: state.artboards.map((a) =>
        a.id === id ? normaliseArtboard({ ...a, design }) : a,
      ),
    })),
  removeArtboard: (id) =>
    set((state) => ({
      artboards: state.artboards.filter((a) => a.id !== id),
      selection: state.selection.filter((s) => s !== id),
      // Wiping every node pick is correct here: the picked nodes
      // belonged to artboards that may have just been removed, and the
      // chat composer can't render chips for ids that aren't on the
      // canvas anyway.
      selectedNodeId: null,
      selectedNodeIds: [],
    })),

  updateNodeInArtboard: (artboardId, nodeId, patch) =>
    set((state) => ({
      artboards: state.artboards.map((a) => {
        if (a.id !== artboardId || !a.design) return a;
        const next = updateNodeInTree(a.design, nodeId, patch);
        return { ...a, design: next };
      }),
    })),
  deleteNodeInArtboard: (artboardId, nodeId) =>
    set((state) => {
      const remainingIds = state.selectedNodeIds.filter((s) => s !== nodeId);
      return {
        artboards: state.artboards.map((a) => {
          if (a.id !== artboardId || !a.design) return a;
          const next = deleteNodeInTree(a.design, nodeId);
          return { ...a, design: next };
        }),
        selectedNodeIds: remainingIds,
        // Active id falls back to the new last picked element (or
        // null if the user just deleted the only pinned one).
        selectedNodeId:
          remainingIds.length > 0
            ? remainingIds[remainingIds.length - 1]!
            : state.selectedNodeId === nodeId
              ? null
              : state.selectedNodeId,
      };
    }),

  setFlowViewEnabled: (enabled) => set({ flowViewEnabled: enabled }),
    }),
    {
      // Only the artboard tree is undoable. Camera + selection are
      // session state and would pollute the history.
      partialize: (state): UndoableState => ({ artboards: state.artboards }),
      // Reference equality on the artboards array is enough — every
      // mutation builds a new array, untouched ones reuse references.
      // Skips no-op pushes (idempotent rehydrate from server, etc.).
      equality: (past, current) => past.artboards === current.artboards,
      // Keep the stack tight; ~50 steps covers any reasonable
      // single-session edit history without unbounded memory growth.
      limit: 50,
    },
  ),
);
