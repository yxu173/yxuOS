"use client";

import { create } from "zustand";

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
  /** Selected node inside an artboard — `id` of a DesignNode. Drives the
   * inspector panel. */
  selectedNodeId: string | null;

  /* ─── Camera ────────────────────────────── */
  setCamera: (next: Camera | ((prev: Camera) => Camera)) => void;
  zoomAt: (screenX: number, screenY: number, factor: number) => void;
  panBy: (dx: number, dy: number) => void;

  /* ─── Selection ─────────────────────────── */
  setSelection: (ids: string[]) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;
  selectNode: (id: string | null) => void;

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

export const useDesignCanvas = create<DesignCanvasState>((set) => ({
  artboards: [],
  camera: { x: 120, y: 120, zoom: 0.5 },
  selection: [],
  selectedNodeId: null,

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
  selectOnly: (id) => set({ selection: [id], selectedNodeId: null }),
  clearSelection: () => set({ selection: [], selectedNodeId: null }),
  selectNode: (id) => set({ selectedNodeId: id }),

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
      selectedNodeId: null,
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
    set((state) => ({
      artboards: state.artboards.map((a) => {
        if (a.id !== artboardId || !a.design) return a;
        const next = deleteNodeInTree(a.design, nodeId);
        return { ...a, design: next };
      }),
      selectedNodeId:
        state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    })),
}));
