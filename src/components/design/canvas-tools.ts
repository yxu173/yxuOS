"use client";

import { nanoid } from "nanoid";

import { createDesignComponent } from "@/app/(app)/designs/component-actions";
import {
  fail,
  ok,
  withIdempotency,
  withIdempotencyAsync,
  type ToolResult,
} from "@/lib/tool-result";

import { useDesignCanvas } from "./canvas-store";
import type {
  LibraryAsset,
  LibraryComponent,
} from "./component-library-context";
import type { DesignNode } from "./design-node";
import {
  applyThemeToTree,
  cloneSubtreeWithFreshIds,
  duplicateNodeInTree,
  findNodesInTree,
  patchNodeInTree,
  replaceNodeWithComponentRef,
  validateTree,
  type FindNodePredicate,
  type NodeMatch,
  type NodePatch,
  type Theme,
} from "./node-utils";
import { DEVICE_DIMENSIONS, type Artboard, type DevicePreset } from "./types";

/**
 * Client-side executors for the design canvas tools. These are called
 * by `<DesignChat>` from its `onToolCall` handler — the agent declares
 * tools server-side without `execute`, so the browser runs them here
 * against the live zustand store.
 *
 * Every executor returns a `ToolResult<T>` envelope. Errors that the
 * agent should be able to recover from (`not_found`, `validation_failed`,
 * `preconditions_failed`) come back as `{ ok: false, error: { code, ... } }`
 * instead of throwing.
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
  selectedNodeId: string | null;
}

export function executeQueryCanvas(): ToolResult<QueryCanvasOutput> {
  const state = useDesignCanvas.getState();
  return ok({
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
    selectedNodeId: state.selectedNodeId,
  });
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
  idempotencyKey?: string;
}

export function executeAddArtboard(
  input: AddArtboardInput,
): ToolResult<{ artboardId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();

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
      return fail(
        "invalid_input",
        "device='custom' requires explicit `width` and `height`.",
        "Either pass `width` and `height`, or pick a device preset.",
      );
    }

    if (input.design) {
      const violation = validateTree(input.design);
      if (violation) {
        return fail("validation_failed", violation.message, violation.hint);
      }
    }

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
    return ok({ artboardId: id });
  });
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
  idempotencyKey?: string;
}

export function executeUpdateArtboard(
  input: UpdateArtboardInput,
): ToolResult<{ artboardId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const existing = state.artboards.find((a) => a.id === input.artboardId);
    if (!existing) {
      return fail(
        "not_found",
        `Artboard "${input.artboardId}" not found.`,
        "Call `query_canvas` to refresh artboard ids.",
      );
    }
    if (input.design) {
      const violation = validateTree(input.design);
      if (violation) {
        return fail("validation_failed", violation.message, violation.hint);
      }
    }
    const patch: Partial<Artboard> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.x !== undefined) patch.x = input.x;
    if (input.y !== undefined) patch.y = input.y;
    if (input.width !== undefined) patch.w = input.width;
    if (input.height !== undefined) patch.h = input.height;
    if (input.design !== undefined) patch.design = input.design;
    state.updateArtboard(input.artboardId, patch);
    return ok({ artboardId: input.artboardId });
  });
}

/* ─── delete_artboard ───────────────────────────────────── */

export function executeDeleteArtboard(input: {
  artboardId: string;
  idempotencyKey?: string;
}): ToolResult<{ artboardId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    if (!state.artboards.some((a) => a.id === input.artboardId)) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }
    state.removeArtboard(input.artboardId);
    return ok({ artboardId: input.artboardId });
  });
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
}): ToolResult<GetArtboardOutput> {
  const state = useDesignCanvas.getState();
  const found = state.artboards.find((a) => a.id === input.artboardId);
  if (!found) {
    return fail(
      "not_found",
      `Artboard "${input.artboardId}" not found.`,
      "Call `query_canvas` to refresh artboard ids.",
    );
  }
  return ok({
    id: found.id,
    name: found.name,
    device: found.device,
    x: found.x,
    y: found.y,
    w: found.w,
    h: found.h,
    design: found.design,
  });
}

/* ─── find_nodes ────────────────────────────────────────── */

export interface FindNodesInput extends FindNodePredicate {
  artboardId: string;
  limit?: number;
}

export interface FindNodesOutput {
  matches: NodeMatch[];
  totalMatched: number;
  truncated: boolean;
}

export function executeFindNodes(
  input: FindNodesInput,
): ToolResult<FindNodesOutput> {
  const state = useDesignCanvas.getState();
  const ab = state.artboards.find((a) => a.id === input.artboardId);
  if (!ab) {
    return fail(
      "not_found",
      `Artboard "${input.artboardId}" not found.`,
      "Call `query_canvas` to refresh artboard ids.",
    );
  }
  if (!ab.design) {
    return ok({ matches: [], totalMatched: 0, truncated: false });
  }
  const limit = input.limit ?? 50;
  const result = findNodesInTree(
    ab.design,
    {
      type: input.type,
      tag: input.tag,
      variant: input.variant,
      textIncludes: input.textIncludes,
      hasStyleKey: input.hasStyleKey,
    },
    limit,
  );
  return ok(result);
}

/* ─── patch_node ────────────────────────────────────────── */

export interface PatchNodeInput {
  artboardId: string;
  nodeId: string;
  patch: NodePatch;
  idempotencyKey?: string;
}

export function executePatchNode(
  input: PatchNodeInput,
): ToolResult<{ artboardId: string; nodeId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) {
      return fail(
        "not_found",
        `Artboard "${input.artboardId}" not found.`,
        "Call `query_canvas` to refresh artboard ids.",
      );
    }
    if (!ab.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty — nothing to patch.`,
        "Use `add_artboard` or `update_artboard` with a full design tree first.",
      );
    }
    const nextTree = patchNodeInTree(ab.design, input.nodeId, input.patch);
    if (!nextTree) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${ab.name}".`,
        "Call `find_nodes` or `get_artboard` to see current node ids.",
      );
    }
    state.updateArtboard(input.artboardId, { design: nextTree });
    return ok({ artboardId: input.artboardId, nodeId: input.nodeId });
  });
}

/* ─── duplicate_node ────────────────────────────────────── */

export interface DuplicateNodeInput {
  artboardId: string;
  nodeId: string;
  idempotencyKey?: string;
}

export function executeDuplicateNode(
  input: DuplicateNodeInput,
): ToolResult<{ artboardId: string; newNodeId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }
    if (!ab.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty.`,
        "Use `add_artboard` first.",
      );
    }
    if (ab.design.id === input.nodeId) {
      return fail(
        "preconditions_failed",
        "Can't duplicate the root of an artboard.",
        "Use `add_artboard` to create a sibling page instead.",
      );
    }
    const result = duplicateNodeInTree(ab.design, input.nodeId);
    if (!result) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${ab.name}".`,
        "Call `find_nodes` or `get_artboard` for current ids.",
      );
    }
    state.updateArtboard(input.artboardId, { design: result.tree });
    return ok({
      artboardId: input.artboardId,
      newNodeId: result.newNodeId,
    });
  });
}

/* ─── apply_theme ───────────────────────────────────────── */

export interface ApplyThemeInput {
  artboardId: string;
  theme: Theme;
  idempotencyKey?: string;
}

export function executeApplyTheme(
  input: ApplyThemeInput,
): ToolResult<{
  artboardId: string;
  patchedNodeIds: string[];
  patchCount: number;
}> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }
    if (!ab.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty.`,
        "Use `add_artboard` first.",
      );
    }
    const { tree, patchedNodeIds } = applyThemeToTree(ab.design, input.theme);
    state.updateArtboard(input.artboardId, { design: tree });
    return ok({
      artboardId: input.artboardId,
      patchedNodeIds,
      patchCount: patchedNodeIds.length,
    });
  });
}

/* ─── extract_component ─────────────────────────────────── */

export interface ExtractComponentInput {
  artboardId: string;
  nodeId: string;
  name: string;
  slug?: string;
  idempotencyKey?: string;
}

/**
 * Promote a subtree of an artboard into a saved, reusable component:
 *  1. Clone the subtree with fresh ids.
 *  2. Save it via the `createDesignComponent` server action (Drizzle write,
 *     revalidates `/designs`).
 *  3. Replace the in-artboard node with a `component-ref` pointing at the
 *     new slug.
 *
 * The caller (DesignChat) is responsible for calling `router.refresh()`
 * after this returns so the local component library picks up the new
 * entry; the renderer falls back to a placeholder until the refresh
 * completes.
 */
export async function executeExtractComponent(
  input: ExtractComponentInput,
): Promise<
  ToolResult<{
    artboardId: string;
    componentId: string;
    componentSlug: string;
  }>
> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }
    if (!ab.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty.`,
        "Use `add_artboard` first.",
      );
    }
    if (ab.design.id === input.nodeId) {
      return fail(
        "preconditions_failed",
        "Can't extract the root of an artboard as a component.",
        "Pick a child node — a section, card, or specific element.",
      );
    }

    const cloned = cloneSubtreeWithFreshIds(ab.design, input.nodeId);
    if (!cloned) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${ab.name}".`,
        "Call `find_nodes` or `get_artboard` for current ids.",
      );
    }

    let saved: { id: string; slug: string };
    try {
      saved = await createDesignComponent({
        name: input.name,
        slug: input.slug,
        // Server action accepts a generic Record — DesignNode trees are
        // JSON-compatible.
        tree: cloned as unknown as Record<string, unknown>,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "Failed to save component.",
      );
    }

    // Replace the source node with a component-ref so future edits to the
    // saved component propagate everywhere.
    const nextTree = replaceNodeWithComponentRef(
      ab.design,
      input.nodeId,
      saved.slug,
    );
    if (nextTree) {
      state.updateArtboard(input.artboardId, { design: nextTree });
    }

    return ok({
      artboardId: input.artboardId,
      componentId: saved.id,
      componentSlug: saved.slug,
    });
  });
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
): ToolResult<ListComponentsOutput> {
  return ok({
    components: components.map((c) => ({
      slug: c.slug,
      name: c.name,
      rootType: c.tree.type,
      nodeCount: countNodes(c.tree),
    })),
  });
}

function countNodes(node: DesignNode): number {
  let n = 1;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) n += countNodes(child);
  }
  return n;
}

/* ─── list_assets ──────────────────────────────────────── */

export interface ListAssetsOutput {
  assets: Array<{
    name: string;
    url: string;
    mimeType: string;
  }>;
}

export function executeListAssets(
  assets: LibraryAsset[],
): ToolResult<ListAssetsOutput> {
  return ok({
    assets: assets.map((a) => ({
      name: a.name,
      url: a.url,
      mimeType: a.mimeType,
    })),
  });
}
