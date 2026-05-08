"use client";

import { nanoid } from "nanoid";

import { saveDesignAssetFromDataUrl } from "@/app/(app)/designs/asset-actions";
import {
  createDesignComponent,
  updateDesignComponentBySlug,
} from "@/app/(app)/designs/component-actions";
import {
  patchDesignTokens,
  patchTeamDesignTokens,
} from "@/app/(app)/designs/token-actions";
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
  cloneSubtreeWithFreshIds,
  collectFlowEdgesFromArtboards,
  deleteNodesInTree,
  duplicateNodeInTree,
  findNodeInTree,
  findNodesInTree,
  insertNodesIntoTree,
  moveNodesInTree,
  patchNodeInTree,
  regenerateIds,
  replaceNodeWithComponentRef,
  setNodeFlowTo,
  validateTree,
  type FindNodePredicate,
  type FlowEdgeRow,
  type InsertPosition,
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

/**
 * `apply_theme` is now thin sugar over `set_tokens(scope: "design", …)`.
 * Each `theme` field maps to a well-known token path:
 *
 *   accent           → color.accent
 *   accentForeground → color.accentForeground
 *   radius           → radius.md
 *   fontFamily       → font.family
 *
 * Re-skin happens at the renderer level: every node whose style
 * references one of these tokens (e.g. `\"{color.accent}\"`) reads
 * the new value on the next paint. Inline literals (raw hex codes,
 * raw numbers) are unchanged — that's a deliberate trade for
 * predictability over the old heuristic-walk behavior.
 *
 * Server write is idempotent and patch-style; passing an unset field
 * doesn't clobber anything.
 */
export async function executeApplyTheme(
  input: ApplyThemeInput,
  ctx: TokenWriteContext,
): Promise<
  ToolResult<{
    artboardId: string;
    tokensWritten: string[];
  }>
> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    // Build the token patch from the legacy theme fields.
    const patch: Record<string, string | number | null> = {};
    const writtenKeys: string[] = [];
    if (input.theme.accent !== undefined) {
      patch["color.accent"] = input.theme.accent;
      writtenKeys.push("color.accent");
    }
    if (input.theme.accentForeground !== undefined) {
      patch["color.accentForeground"] = input.theme.accentForeground;
      writtenKeys.push("color.accentForeground");
    }
    if (input.theme.radius !== undefined) {
      patch["radius.md"] = input.theme.radius;
      writtenKeys.push("radius.md");
    }
    if (input.theme.fontFamily !== undefined) {
      patch["font.family"] = input.theme.fontFamily;
      writtenKeys.push("font.family");
    }

    if (writtenKeys.length === 0) {
      return fail(
        "invalid_input",
        "apply_theme called with no fields set.",
        "Pass at least one of `accent` / `accentForeground` / `radius` / `fontFamily`.",
      );
    }

    try {
      await patchDesignTokens({
        designId: ctx.designId,
        patch,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "Failed to write tokens.",
      );
    }

    // Optimistic push — every artboard that uses these token refs
    // re-skins on the next React frame, no router.refresh() round-trip.
    ctx.registerOptimisticDesignTokens(patch);

    return ok({
      artboardId: input.artboardId,
      tokensWritten: writtenKeys,
    });
  });
}

/* ─── list_tokens / set_tokens ─────────────────────────── */

export interface TokenWriteContext {
  designId: string;
  registerOptimisticDesignTokens: (
    patch: Record<string, string | number | null>,
  ) => void;
  registerOptimisticTeamTokens: (
    patch: Record<string, string | number | null>,
  ) => void;
}

export interface TokenReadContext {
  team: Record<string, string | number>;
  design: Record<string, string | number>;
  merged: Record<string, string | number>;
}

export interface ListTokensOutput {
  team: Record<string, string | number>;
  design: Record<string, string | number>;
  merged: Record<string, string | number>;
  commonPaths: string[];
}

const COMMON_PATHS_FOR_AGENT = [
  "color.accent",
  "color.accentForeground",
  "color.background",
  "color.foreground",
  "color.muted",
  "color.border",
  "font.family",
  "font.size.h1",
  "font.size.h2",
  "font.size.body",
  "radius.sm",
  "radius.md",
  "radius.lg",
  "spacing.section",
  "spacing.gutter",
];

/**
 * Read-only view of the design's token set. Pure context read — no
 * mutation, no idempotency wrapper needed.
 */
export function executeListTokens(
  ctx: TokenReadContext,
): ToolResult<ListTokensOutput> {
  return ok({
    team: ctx.team,
    design: ctx.design,
    merged: ctx.merged,
    commonPaths: COMMON_PATHS_FOR_AGENT,
  });
}

export interface SetTokensInput {
  scope: "design" | "team";
  patch: Record<string, string | number | null>;
  idempotencyKey?: string;
}

export interface SetTokensOutput {
  scope: "design" | "team";
  tokens: Record<string, string | number>;
  writtenKeys: string[];
  clearedKeys: string[];
}

/**
 * Write design tokens at either the per-design or team scope. The
 * patch is applied server-side first; on success we push the same
 * patch into the optimistic overlay so the renderer re-skins
 * immediately.
 */
export async function executeSetTokens(
  input: SetTokensInput,
  ctx: TokenWriteContext,
): Promise<ToolResult<SetTokensOutput>> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    if (Object.keys(input.patch).length === 0) {
      return fail(
        "invalid_input",
        "Empty patch — nothing to write.",
        "Pass at least one key in `patch`.",
      );
    }

    const writtenKeys: string[] = [];
    const clearedKeys: string[] = [];
    for (const [k, v] of Object.entries(input.patch)) {
      if (v === null) clearedKeys.push(k);
      else writtenKeys.push(k);
    }

    let serverResult: { tokens: Record<string, string | number> };
    try {
      if (input.scope === "design") {
        serverResult = await patchDesignTokens({
          designId: ctx.designId,
          patch: input.patch,
        });
      } else {
        serverResult = await patchTeamDesignTokens({
          patch: input.patch,
        });
      }
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "Failed to write tokens.",
      );
    }

    // Optimistic overlay push — keeps the canvas in sync before
    // router.refresh() round-trips.
    if (input.scope === "design") {
      ctx.registerOptimisticDesignTokens(input.patch);
    } else {
      ctx.registerOptimisticTeamTokens(input.patch);
    }

    return ok({
      scope: input.scope,
      tokens: serverResult.tokens,
      writtenKeys,
      clearedKeys,
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
 * The optional `onComponentSaved` side channel lets the caller register
 * the new component into the library context optimistically, before
 * `router.refresh()` round-trips the new server-provided list. Without
 * it, `<DesignRenderer>` would render a missing-component placeholder
 * for the in-place ref until the refresh completes.
 */
export async function executeExtractComponent(
  input: ExtractComponentInput,
  options?: {
    onComponentSaved?: (component: LibraryComponent) => void;
  },
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

    // Optimistic library push — render the new component immediately.
    options?.onComponentSaved?.({
      id: saved.id,
      name: input.name,
      slug: saved.slug,
      tree: cloned,
    });

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

/* ─── add_nodes ─────────────────────────────────────────── */

export interface AddNodesInput {
  artboardId: string;
  targetNodeId: string;
  position: InsertPosition;
  nodes: DesignNode[];
  idempotencyKey?: string;
}

export function executeAddNodes(
  input: AddNodesInput,
): ToolResult<{ artboardId: string; insertedNodeIds: string[] }> {
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
        `Artboard "${ab.name}" is empty.`,
        "Use `add_artboard` or `update_artboard` with a tree first.",
      );
    }

    // Validate every incoming subtree before we touch the live tree —
    // failing fast keeps the canvas consistent.
    for (const node of input.nodes) {
      const violation = validateTree(node);
      if (violation) {
        return fail("validation_failed", violation.message, violation.hint);
      }
    }

    const insertion = insertNodesIntoTree(
      ab.design,
      { id: input.targetNodeId, position: input.position },
      input.nodes,
    );
    if ("error" in insertion) {
      // `not_found` covers missing target/anchor; anything else is a
      // precondition (leaf parent, root before/after).
      const isMissing = insertion.error.message.includes("not found");
      return fail(
        isMissing ? "not_found" : "preconditions_failed",
        insertion.error.message,
        insertion.error.hint,
      );
    }

    state.updateArtboard(input.artboardId, { design: insertion.result.tree });
    return ok({
      artboardId: input.artboardId,
      insertedNodeIds: insertion.result.insertedNodeIds,
    });
  });
}

/* ─── delete_nodes ──────────────────────────────────────── */

export interface DeleteNodesInput {
  artboardId: string;
  nodeIds: string[];
  idempotencyKey?: string;
}

export function executeDeleteNodes(
  input: DeleteNodesInput,
): ToolResult<{ artboardId: string; deletedNodeIds: string[] }> {
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
        "Nothing to delete.",
      );
    }
    if (ab.design.id && input.nodeIds.includes(ab.design.id)) {
      return fail(
        "preconditions_failed",
        "Can't delete the artboard root via `delete_nodes`.",
        "Use `delete_artboard` to remove the whole artboard.",
      );
    }

    const { tree, deletedNodeIds } = deleteNodesInTree(
      ab.design,
      new Set(input.nodeIds),
    );

    if (deletedNodeIds.length === 0) {
      // No-op — every id was missing. Surface as not_found so the
      // agent re-reads ids before retrying.
      return fail(
        "not_found",
        "None of the requested node ids were found in the artboard.",
        "Call `find_nodes` or `get_artboard` to see current ids.",
      );
    }

    state.updateArtboard(input.artboardId, { design: tree });
    return ok({
      artboardId: input.artboardId,
      deletedNodeIds,
    });
  });
}

/* ─── move_nodes ────────────────────────────────────────── */

export interface MoveNodesInput {
  artboardId: string;
  nodeIds: string[];
  targetNodeId: string;
  position: InsertPosition;
  idempotencyKey?: string;
}

export function executeMoveNodes(
  input: MoveNodesInput,
): ToolResult<{ artboardId: string; movedNodeIds: string[] }> {
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
        "Nothing to move.",
      );
    }

    const result = moveNodesInTree(
      ab.design,
      input.nodeIds,
      { id: input.targetNodeId, position: input.position },
    );
    if ("error" in result) {
      const isMissing = result.error.message.includes("not found");
      return fail(
        isMissing ? "not_found" : "preconditions_failed",
        result.error.message,
        result.error.hint,
      );
    }

    state.updateArtboard(input.artboardId, { design: result.tree });
    return ok({
      artboardId: input.artboardId,
      movedNodeIds: result.movedNodeIds,
    });
  });
}

/* ─── patch_nodes (plural) ──────────────────────────────── */

export interface PatchNodesInput {
  artboardId: string;
  nodeIds: string[];
  patch: NodePatch;
  idempotencyKey?: string;
}

export function executePatchNodes(
  input: PatchNodesInput,
): ToolResult<{ artboardId: string; patchedNodeIds: string[] }> {
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

    let tree = ab.design;
    const patchedNodeIds: string[] = [];
    const missing: string[] = [];

    // Walk each id sequentially: each patch is independent so order
    // doesn't matter, and we want to keep the call partial-success
    // friendly (missing ids become warnings, not a hard error).
    for (const nodeId of input.nodeIds) {
      const next = patchNodeInTree(tree, nodeId, input.patch);
      if (next) {
        tree = next;
        patchedNodeIds.push(nodeId);
      } else {
        missing.push(nodeId);
      }
    }

    if (patchedNodeIds.length === 0) {
      return fail(
        "not_found",
        "None of the requested node ids were found in the artboard.",
        "Call `find_nodes` or `get_artboard` to see current ids.",
      );
    }

    state.updateArtboard(input.artboardId, { design: tree });

    const warnings: string[] | undefined =
      missing.length > 0
        ? [
            `Skipped ${missing.length} missing node id${
              missing.length === 1 ? "" : "s"
            }: ${missing.slice(0, 5).join(", ")}${
              missing.length > 5 ? "…" : ""
            }`,
          ]
        : undefined;
    return ok({ artboardId: input.artboardId, patchedNodeIds }, warnings);
  });
}

/* ─── duplicate_artboard ────────────────────────────────── */

export interface DuplicateArtboardInput {
  artboardId: string;
  name?: string;
  x?: number;
  y?: number;
  idempotencyKey?: string;
}

export function executeDuplicateArtboard(
  input: DuplicateArtboardInput,
): ToolResult<{ artboardId: string; sourceArtboardId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const source = state.artboards.find((a) => a.id === input.artboardId);
    if (!source) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }

    // Default placement: 80-px gap to the right of the source. Same
    // rule as `add_artboard`'s auto-placement so duplicates flow
    // visually with new artboards.
    const x = input.x ?? source.x + source.w + 80;
    const y = input.y ?? source.y;
    const name = input.name?.trim() || `${source.name} (copy)`;

    // Deep-clone the design tree with fresh ids so the new artboard's
    // nodes are independently targetable.
    const designClone = source.design ? regenerateIds(source.design) : null;

    const id = nanoid();
    const artboard: Artboard = {
      id,
      name,
      device: source.device,
      x,
      y,
      w: source.w,
      h: source.h,
      design: designClone,
      ...(source.background ? { background: source.background } : {}),
    };
    state.addArtboard(artboard);
    state.selectOnly(id);
    return ok({ artboardId: id, sourceArtboardId: source.id });
  });
}

/* ─── update_component ──────────────────────────────────── */

export interface UpdateComponentInput {
  componentSlug: string;
  name?: string;
  tree: DesignNode;
  idempotencyKey?: string;
}

/**
 * Replace a saved component's tree (and optionally its display name).
 * The new tree is validated structurally before the server write so
 * malformed updates fail fast with `validation_failed` instead of
 * landing a broken component that breaks every artboard referencing it.
 *
 * The optional `onComponentSaved` side channel lets the caller push the
 * updated tree into the library context optimistically — every
 * artboard with a `component-ref` to this slug then re-renders the new
 * tree on the next paint, no `router.refresh()` round-trip needed.
 */
export async function executeUpdateComponent(
  input: UpdateComponentInput,
  components: LibraryComponent[],
  options?: {
    onComponentSaved?: (component: LibraryComponent) => void;
  },
): Promise<ToolResult<{ componentSlug: string }>> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    const existing = components.find((c) => c.slug === input.componentSlug);
    if (!existing) {
      return fail(
        "not_found",
        `Component "${input.componentSlug}" not found.`,
        "Call `list_components` to refresh the library.",
      );
    }

    const violation = validateTree(input.tree);
    if (violation) {
      return fail("validation_failed", violation.message, violation.hint);
    }

    let saved: { id: string; slug: string };
    try {
      saved = await updateDesignComponentBySlug({
        slug: input.componentSlug,
        tree: input.tree as unknown as Record<string, unknown>,
        name: input.name,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "Failed to update component.",
      );
    }

    // Optimistic library push — every artboard with a component-ref to
    // this slug re-renders with the new tree on the next React frame.
    options?.onComponentSaved?.({
      id: saved.id,
      name: input.name?.trim() || existing.name,
      slug: saved.slug,
      tree: input.tree,
    });

    return ok({ componentSlug: input.componentSlug });
  });
}

/* ─── save_attachment_as_asset ─────────────────────────── */

export interface SaveAttachmentAsAssetInput {
  filename: string;
  name?: string;
  idempotencyKey?: string;
}

export interface SaveAttachmentAsAssetOutput {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Lookup shape passed in by the chat dispatcher — every recent
 * FileUIPart with its original data URL, plus the filename used to
 * find it. Keeping it as a flat array (instead of a deep
 * `UIMessage[]`) lets the executor stay decoupled from the AI SDK
 * UIMessage type.
 */
export interface ChatFileLookup {
  filename: string;
  mediaType?: string;
  url: string;
}

/**
 * Persist a chat-attached image into `design_assets` so the agent can
 * reference it via its public Blob URL on the same turn.
 *
 * Architecture note: the agent passes only the `filename`, not the
 * data URL itself. Echoing megabytes of base64 through tool args
 * would burn tokens and risk truncation — instead the chat dispatcher
 * (which has direct access to the message stream) finds the matching
 * FileUIPart locally and hands the bytes to this executor. The model
 * never has to quote the bytes back.
 */
export async function executeSaveAttachmentAsAsset(
  input: SaveAttachmentAsAssetInput,
  chatFiles: ChatFileLookup[],
): Promise<ToolResult<SaveAttachmentAsAssetOutput>> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    // Find the most recent FileUIPart whose filename matches. Most
    // recent wins because the user might re-paste the same file with
    // different bytes during a long conversation.
    const match = [...chatFiles]
      .reverse()
      .find((f) => f.filename === input.filename);
    if (!match) {
      return fail(
        "not_found",
        `No attachment named "${input.filename}" in the recent chat history.`,
        "The user must have attached the image in a message you can see. Check the filename — it must match exactly.",
      );
    }
    if (!match.url.startsWith("data:")) {
      // Already a public URL — must have been persisted by something
      // else. Treat that as a precondition violation rather than
      // silently re-uploading from a remote URL (which would need a
      // fetch + auth dance we don't want here).
      return fail(
        "preconditions_failed",
        `Attachment "${input.filename}" is already a public URL, not a data URL.`,
        "Use it directly as `image.src` in a design tree — no need to save again.",
      );
    }

    let saved: SaveAttachmentAsAssetOutput;
    try {
      saved = await saveDesignAssetFromDataUrl({
        dataUrl: match.url,
        filename: input.name?.trim() || input.filename,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "Failed to save asset.",
      );
    }
    return ok(saved);
  });
}

/* ─── screenshot_artboard ──────────────────────────────── */

export interface ScreenshotArtboardInput {
  artboardId: string;
  scale?: number;
}

export interface ScreenshotArtboardOutput {
  artboardId: string;
  width: number;
  height: number;
  dataUrl: string;
  scale: number;
  sizeBytes: number;
}

/** Maximum payload size for the screenshot data URL. Past ~2 MB the
 *  combined JSON envelope + base64 overhead starts to choke smaller
 *  inference contexts and slow streaming. The executor auto-retries at
 *  successively smaller scales before giving up with `size_limit`. */
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const FALLBACK_SCALES = [1, 0.75, 0.5, 0.35, 0.25] as const;

/**
 * Capture a PNG of the rendered artboard frame and hand it back to the
 * agent so it can self-review.
 *
 * The DOM ref is found by `data-artboard-frame-id` (set in
 * artboard-view.tsx) — no extra context needed because the rendered
 * design is already in the live DOM tree of this tab.
 *
 * Anti-blowup: the executor walks `FALLBACK_SCALES` from the requested
 * scale down, returning the first encoding that fits in
 * `MAX_SCREENSHOT_BYTES`. If even the smallest scale is too big, fails
 * with `size_limit` so the agent knows to crop / shrink the artboard
 * before retrying.
 */
export async function executeScreenshotArtboard(
  input: ScreenshotArtboardInput,
): Promise<ToolResult<ScreenshotArtboardOutput>> {
  const state = useDesignCanvas.getState();
  const ab = state.artboards.find((a) => a.id === input.artboardId);
  if (!ab) {
    return fail(
      "not_found",
      `Artboard "${input.artboardId}" not found.`,
      "Call `query_canvas` to refresh artboard ids.",
    );
  }

  // Look up the rendered frame DOM. In the unlikely case the artboard
  // is offscreen / not yet mounted, surface a recoverable error so the
  // agent can wait a tick and retry.
  const node = document.querySelector<HTMLElement>(
    `[data-artboard-frame-id="${input.artboardId}"]`,
  );
  if (!node) {
    return fail(
      "canvas_unavailable",
      "Artboard isn't rendered in the current viewport — can't screenshot it.",
      "Wait for the next tool call or scroll the artboard into view.",
    );
  }

  // Lazy-load html-to-image (~25 KB) only when the agent actually asks
  // for a screenshot. Avoids regressing the design page's first paint.
  const { toPng } = await import("html-to-image");

  // Determine which scales to try. If the model requested a specific
  // scale we honour it as the starting point and walk down from there.
  const requested = input.scale ?? 1;
  const scales = FALLBACK_SCALES.filter((s) => s <= requested);
  if (scales.length === 0) scales.push(0.25); // safety net

  let lastErr: unknown = null;
  for (const scale of scales) {
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: scale,
        cacheBust: true,
        // Fonts loaded via system stack don't need embedding; skipping
        // their fetch keeps the snapshot fast and avoids CORS noise.
        skipFonts: true,
        backgroundColor: ab.background ?? "#ffffff",
      });
      const sizeBytes = estimateDataUrlBytes(dataUrl);
      if (sizeBytes <= MAX_SCREENSHOT_BYTES) {
        return ok({
          artboardId: ab.id,
          width: Math.round(ab.w * scale),
          height: Math.round(ab.h * scale),
          dataUrl,
          scale,
          sizeBytes,
        });
      }
      // Too big — drop down a notch and try again.
      lastErr = new Error(
        `Screenshot too large at ${scale}× (${formatBytes(sizeBytes)}); retrying smaller.`,
      );
    } catch (err) {
      lastErr = err;
    }
  }

  // If every fallback scale failed for a non-size reason (e.g.
  // html-to-image threw), fall through to `internal` instead of a
  // misleading `size_limit`. Detect the difference by checking whether
  // the last error came from html-to-image or our own size guard.
  const allWereSizeBlocked =
    lastErr instanceof Error && lastErr.message.includes("Screenshot too large");
  if (!allWereSizeBlocked && lastErr) {
    return fail(
      "internal",
      lastErr instanceof Error ? lastErr.message : "Failed to capture screenshot.",
    );
  }
  return fail(
    "size_limit",
    `Could not produce a screenshot under ${formatBytes(MAX_SCREENSHOT_BYTES)} even at the smallest scale.`,
    "The artboard may be too tall or too dense — temporarily shrink it via `update_artboard` (e.g. height 1200) and retry, or split the design into multiple artboards.",
  );
}

/** Approximate the decoded byte size of a data URL without actually
 *  decoding. Base64 = ~4/3 of the binary. Subtract the prefix once. */
function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  // Base64 padding: each `=` represents one fewer byte.
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/* ─── connect_artboards / disconnect_artboards / list_flows ─ */

export interface ConnectArtboardsInput {
  artboardId: string;
  nodeId: string;
  toArtboardId: string;
  idempotencyKey?: string;
}

export function executeConnectArtboards(
  input: ConnectArtboardsInput,
): ToolResult<{
  artboardId: string;
  nodeId: string;
  toArtboardId: string;
}> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const sourceArtboard = state.artboards.find(
      (a) => a.id === input.artboardId,
    );
    if (!sourceArtboard) {
      return fail(
        "not_found",
        `Source artboard "${input.artboardId}" not found.`,
        "Call `query_canvas` to refresh artboard ids.",
      );
    }
    if (!state.artboards.some((a) => a.id === input.toArtboardId)) {
      return fail(
        "not_found",
        `Target artboard "${input.toArtboardId}" not found.`,
        "Call `query_canvas` to refresh artboard ids.",
      );
    }
    if (!sourceArtboard.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${sourceArtboard.name}" is empty — no node to connect.`,
      );
    }

    // Distinguish "node missing" from "node is wrong type" so the
    // hint is actionable. setNodeFlowTo returns null for both, so we
    // peek with findNodeInTree first.
    const node = findNodeInTree(sourceArtboard.design, input.nodeId);
    if (!node) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${sourceArtboard.name}".`,
        "Call `find_nodes` or `get_artboard` for current ids.",
      );
    }
    if (node.type !== "button" && node.type !== "link") {
      return fail(
        "preconditions_failed",
        `Only buttons and links can carry a flow link (got type="${node.type}").`,
        "Pick a button or link node, or wrap the action with one.",
      );
    }

    const nextTree = setNodeFlowTo(sourceArtboard.design, input.nodeId, {
      artboardId: input.toArtboardId,
    });
    if (!nextTree) {
      // Defensive — we already validated both branches above.
      return fail("internal", "Failed to apply flow link.");
    }
    state.updateArtboard(input.artboardId, { design: nextTree });
    return ok({
      artboardId: input.artboardId,
      nodeId: input.nodeId,
      toArtboardId: input.toArtboardId,
    });
  });
}

export interface DisconnectArtboardsInput {
  artboardId: string;
  nodeId: string;
  idempotencyKey?: string;
}

export function executeDisconnectArtboards(
  input: DisconnectArtboardsInput,
): ToolResult<{ artboardId: string; nodeId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) {
      return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    }
    if (!ab.design) {
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty — nothing to disconnect.`,
      );
    }
    const node = findNodeInTree(ab.design, input.nodeId);
    if (!node) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${ab.name}".`,
        "Call `find_nodes` or `get_artboard` for current ids.",
      );
    }
    if (node.type !== "button" && node.type !== "link") {
      // Already not flowing anywhere, but be explicit about it so the
      // agent knows it's dealing with a non-flow node.
      return fail(
        "preconditions_failed",
        `Node type="${node.type}" can't carry a flow link in the first place.`,
      );
    }
    const nextTree = setNodeFlowTo(ab.design, input.nodeId, null);
    if (!nextTree) {
      return fail("internal", "Failed to remove flow link.");
    }
    state.updateArtboard(input.artboardId, { design: nextTree });
    return ok({ artboardId: input.artboardId, nodeId: input.nodeId });
  });
}

export interface ListFlowsOutput {
  flows: FlowEdgeRow[];
}

export function executeListFlows(): ToolResult<ListFlowsOutput> {
  const state = useDesignCanvas.getState();
  return ok({
    flows: collectFlowEdgesFromArtboards(state.artboards),
  });
}

/* ─── helpers ──────────────────────────────────────────── */

// Re-exported so the chat can ask "is this id even in the tree?" before
// dispatching multi-node tools — currently unused but kept here so the
// plural executors and any future inspector code can share the import.
export { findNodeInTree };
