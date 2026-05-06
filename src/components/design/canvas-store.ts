"use client";

import { create } from "zustand";

import type { Artboard, Camera, DesignNodeRoot } from "./types";

/* ─── Zoom bounds ─── */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

interface DesignCanvasState {
  artboards: Artboard[];
  camera: Camera;
  /** Selected artboard ids (currently single-select but typed as array
   * for future shift-click multi-select). */
  selection: string[];

  /* ─── Camera ────────────────────────────── */
  setCamera: (next: Camera | ((prev: Camera) => Camera)) => void;
  zoomAt: (screenX: number, screenY: number, factor: number) => void;
  panBy: (dx: number, dy: number) => void;

  /* ─── Selection ─────────────────────────── */
  setSelection: (ids: string[]) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;

  /* ─── Artboards ─────────────────────────── */
  setArtboards: (artboards: Artboard[]) => void;
  addArtboard: (artboard: Artboard) => void;
  updateArtboard: (id: string, patch: Partial<Artboard>) => void;
  updateArtboardDesign: (id: string, design: DesignNodeRoot | null) => void;
  removeArtboard: (id: string) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const useDesignCanvas = create<DesignCanvasState>((set) => ({
  artboards: [],
  camera: { x: 120, y: 120, zoom: 0.5 },
  selection: [],

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
  selectOnly: (id) => set({ selection: [id] }),
  clearSelection: () => set({ selection: [] }),

  setArtboards: (artboards) => set({ artboards }),
  addArtboard: (artboard) =>
    set((state) => ({ artboards: [...state.artboards, artboard] })),
  updateArtboard: (id, patch) =>
    set((state) => ({
      artboards: state.artboards.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })),
  updateArtboardDesign: (id, design) =>
    set((state) => ({
      artboards: state.artboards.map((a) =>
        a.id === id ? { ...a, design } : a,
      ),
    })),
  removeArtboard: (id) =>
    set((state) => ({
      artboards: state.artboards.filter((a) => a.id !== id),
      selection: state.selection.filter((s) => s !== id),
    })),
}));
