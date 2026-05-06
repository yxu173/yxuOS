"use client";

import { nanoid } from "nanoid";

import { useDesignCanvas } from "./canvas-store";
import type { LibraryComponent } from "./component-library-context";
import type { DesignNode } from "./design-node";
import { DEVICE_DIMENSIONS, type Artboard, type DevicePreset } from "./types";

/**
 * Client-side executors for the design canvas tools. These are called
 * by `<DesignChat>` from its `onToolCall` handler — the agent declares
 * tools server-side without `execute`, so the browser runs them here
 * against the live zustand store.
 */

/* ─── query_canvas ──────────────────────────────────────── */

export interface QueryCanvasOutput {
  artboards: Array<{
    id: string;
    name: string;
    device: string;
    x: number;
    y: number;
    w: number;
    h: number;
    hasDesign: boolean;
    rootNodeType?: string;
  }>;
  selectedArtboardIds: string[];
}

export function executeQueryCanvas(): QueryCanvasOutput {
  const state = useDesignCanvas.getState();
  return {
    artboards: state.artboards.map((a) => ({
      id: a.id,
      name: a.name,
      device: a.device,
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      hasDesign: a.design !== null,
      rootNodeType: a.design?.type,
    })),
    selectedArtboardIds: state.selection,
  };
}

/* ─── add_artboard ──────────────────────────────────────── */

export interface AddArtboardInput {
  name: string;
  device: DevicePreset;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  design?: DesignNode | null;
}

export function executeAddArtboard(input: AddArtboardInput): {
  artboardId: string;
} {
  const state = useDesignCanvas.getState();

  // Resolve dimensions.
  let w = input.width;
  let h = input.height;
  if (input.device !== "custom") {
    const preset = DEVICE_DIMENSIONS[input.device];
    if (preset) {
      w = w ?? preset.w;
      h = h ?? preset.h;
    }
  }
  if (!w || !h) {
    throw new Error(
      "device=custom requires explicit `width` and `height`; or specify a device preset.",
    );
  }

  // Resolve position. If unspecified, place to the right of the rightmost
  // existing artboard with a 80-px gutter; on an empty canvas, world (0, 0).
  let x = input.x;
  let y = input.y;
  if (x === undefined || y === undefined) {
    const rightmost =
      state.artboards.length === 0
        ? null
        : state.artboards.reduce((acc, a) =>
            a.x + a.w > acc.x + acc.w ? a : acc,
          );
    x = x ?? (rightmost ? rightmost.x + rightmost.w + 80 : 0);
    y = y ?? (rightmost ? rightmost.y : 0);
  }

  const id = nanoid();
  const artboard: Artboard = {
    id,
    name: input.name,
    device: input.device,
    x,
    y,
    w,
    h,
    design: input.design ?? null,
  };
  state.addArtboard(artboard);
  state.selectOnly(id);
  return { artboardId: id };
}

/* ─── update_artboard ───────────────────────────────────── */

export interface UpdateArtboardInput {
  artboardId: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  design?: DesignNode | null;
}

export function executeUpdateArtboard(input: UpdateArtboardInput): {
  artboardId: string;
} {
  const state = useDesignCanvas.getState();
  const existing = state.artboards.find((a) => a.id === input.artboardId);
  if (!existing) {
    throw new Error(`Artboard "${input.artboardId}" not found.`);
  }
  const patch: Partial<Artboard> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.x !== undefined) patch.x = input.x;
  if (input.y !== undefined) patch.y = input.y;
  if (input.width !== undefined) patch.w = input.width;
  if (input.height !== undefined) patch.h = input.height;
  if (input.design !== undefined) patch.design = input.design;
  state.updateArtboard(input.artboardId, patch);
  return { artboardId: input.artboardId };
}

/* ─── delete_artboard ───────────────────────────────────── */

export function executeDeleteArtboard(input: { artboardId: string }): {
  artboardId: string;
} {
  const state = useDesignCanvas.getState();
  if (!state.artboards.some((a) => a.id === input.artboardId)) {
    throw new Error(`Artboard "${input.artboardId}" not found.`);
  }
  state.removeArtboard(input.artboardId);
  return { artboardId: input.artboardId };
}

/* ─── get_artboard ──────────────────────────────────────── */

export interface GetArtboardOutput {
  id: string;
  name: string;
  device: string;
  x: number;
  y: number;
  w: number;
  h: number;
  design: DesignNode | null;
}

export function executeGetArtboard(input: {
  artboardId: string;
}): GetArtboardOutput {
  const state = useDesignCanvas.getState();
  const found = state.artboards.find((a) => a.id === input.artboardId);
  if (!found) {
    throw new Error(`Artboard "${input.artboardId}" not found.`);
  }
  return {
    id: found.id,
    name: found.name,
    device: found.device,
    x: found.x,
    y: found.y,
    w: found.w,
    h: found.h,
    design: found.design,
  };
}

/* ─── list_components ───────────────────────────────────── */

export interface ListComponentsOutput {
  components: Array<{
    slug: string;
    name: string;
    rootType: string;
    nodeCount: number;
  }>;
}

export function executeListComponents(
  components: LibraryComponent[],
): ListComponentsOutput {
  return {
    components: components.map((c) => ({
      slug: c.slug,
      name: c.name,
      rootType: c.tree.type,
      nodeCount: countNodes(c.tree),
    })),
  };
}

function countNodes(node: DesignNode): number {
  let n = 1;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) n += countNodes(child);
  }
  return n;
}
