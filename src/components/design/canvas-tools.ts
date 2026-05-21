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
  alignNodesInTree,
  arrangeArtboards,
  auditTree,
  distributeChildrenInTree,
  replaceNodeInTree,
  setNodeHiddenInTree,
  unwrapNodeInTree,
  wrapNodesInTree,
  type AlignMode,
  type ArrangeStrategy,
  type AuditIssue,
  type DistributeMode,
} from "./design-ops";
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

/* ─── wrap_nodes ───────────────────────────────────────── */

export interface WrapNodesInput {
  artboardId: string;
  nodeIds: string[];
  containerType: "div" | "section" | "card" | "frame" | "nav";
  style?: Record<string, string | number>;
  idempotencyKey?: string;
}

export function executeWrapNodes(
  input: WrapNodesInput,
): ToolResult<{
  artboardId: string;
  containerId: string;
  wrappedNodeIds: string[];
}> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    if (!ab.design)
      return fail(
        "preconditions_failed",
        `Artboard "${ab.name}" is empty.`,
        "Use `add_artboard` first.",
      );
    const result = wrapNodesInTree(
      ab.design,
      input.nodeIds,
      input.containerType,
      input.style,
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
      containerId: result.containerId,
      wrappedNodeIds: result.wrappedNodeIds,
    });
  });
}

/* ─── unwrap_node ──────────────────────────────────────── */

export interface UnwrapNodeInput {
  artboardId: string;
  nodeId: string;
  idempotencyKey?: string;
}

export function executeUnwrapNode(
  input: UnwrapNodeInput,
): ToolResult<{ artboardId: string; promotedNodeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    if (!ab.design)
      return fail("preconditions_failed", `Artboard "${ab.name}" is empty.`);
    const result = unwrapNodeInTree(ab.design, input.nodeId);
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
      promotedNodeIds: result.promotedNodeIds,
    });
  });
}

/* ─── replace_node ─────────────────────────────────────── */

export interface ReplaceNodeInput {
  artboardId: string;
  nodeId: string;
  replacement: DesignNode;
  idempotencyKey?: string;
}

export function executeReplaceNode(
  input: ReplaceNodeInput,
): ToolResult<{ artboardId: string; newNodeId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    if (!ab.design)
      return fail("preconditions_failed", `Artboard "${ab.name}" is empty.`);
    const violation = validateTree(input.replacement);
    if (violation) {
      return fail("validation_failed", violation.message, violation.hint);
    }
    const result = replaceNodeInTree(ab.design, input.nodeId, input.replacement);
    if (!result) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found, or is the artboard root.`,
        "For root replacement, use `update_artboard` with the new tree.",
      );
    }
    state.updateArtboard(input.artboardId, { design: result.tree });
    return ok({ artboardId: input.artboardId, newNodeId: result.newNodeId });
  });
}

/* ─── set_node_visibility ──────────────────────────────── */

export interface SetNodeVisibilityInput {
  artboardId: string;
  nodeId: string;
  hidden: boolean;
  idempotencyKey?: string;
}

export function executeSetNodeVisibility(
  input: SetNodeVisibilityInput,
): ToolResult<{ artboardId: string; nodeId: string; hidden: boolean }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    if (!ab.design)
      return fail("preconditions_failed", `Artboard "${ab.name}" is empty.`);
    const next = setNodeHiddenInTree(ab.design, input.nodeId, input.hidden);
    if (!next) {
      return fail(
        "not_found",
        `Node "${input.nodeId}" not found in artboard "${ab.name}".`,
      );
    }
    state.updateArtboard(input.artboardId, { design: next });
    return ok({
      artboardId: input.artboardId,
      nodeId: input.nodeId,
      hidden: input.hidden,
    });
  });
}

/* ─── align_nodes ──────────────────────────────────────── */

export interface AlignNodesInput {
  artboardId: string;
  nodeIds: string[];
  /** Cross-axis alignment via `alignSelf`. */
  align?: AlignMode;
  /** Optional parent id to set `justifyContent` on (distributes its kids). */
  distributeParentId?: string;
  distribute?: DistributeMode;
  idempotencyKey?: string;
}

export function executeAlignNodes(
  input: AlignNodesInput,
): ToolResult<{
  artboardId: string;
  alignedNodeIds: string[];
  distributedParentId: string | null;
}> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    if (!ab.design)
      return fail("preconditions_failed", `Artboard "${ab.name}" is empty.`);
    if (!input.align && !input.distribute) {
      return fail(
        "invalid_input",
        "Provide `align` or `distribute` (or both).",
      );
    }
    let tree = ab.design;
    let alignedNodeIds: string[] = [];
    if (input.align && input.nodeIds.length > 0) {
      const result = alignNodesInTree(tree, input.nodeIds, input.align);
      tree = result.tree;
      alignedNodeIds = result.patchedNodeIds;
    }
    let distributedParentId: string | null = null;
    if (input.distribute) {
      const parentId =
        input.distributeParentId ?? (tree.id ?? null);
      if (!parentId) {
        return fail(
          "invalid_input",
          "distribute requires `distributeParentId` (defaults to artboard root).",
        );
      }
      const next = distributeChildrenInTree(tree, parentId, input.distribute);
      if (!next) {
        return fail(
          "not_found",
          `Parent "${parentId}" not found or not a container.`,
        );
      }
      tree = next;
      distributedParentId = parentId;
    }
    state.updateArtboard(input.artboardId, { design: tree });
    return ok({
      artboardId: input.artboardId,
      alignedNodeIds,
      distributedParentId,
    });
  });
}

/* ─── audit_design ─────────────────────────────────────── */

export interface AuditDesignInput {
  /** Artboard to audit. Omit to audit every artboard on the canvas. */
  artboardId?: string;
}

export interface AuditDesignOutput {
  artboards: Array<{
    artboardId: string;
    artboardName: string;
    issues: AuditIssue[];
  }>;
  totalIssues: number;
  summary: {
    error: number;
    warning: number;
    info: number;
  };
}

export function executeAuditDesign(
  input: AuditDesignInput,
): ToolResult<AuditDesignOutput> {
  const state = useDesignCanvas.getState();
  const targets = input.artboardId
    ? state.artboards.filter((a) => a.id === input.artboardId)
    : state.artboards;
  if (input.artboardId && targets.length === 0) {
    return fail("not_found", `Artboard "${input.artboardId}" not found.`);
  }
  const summary = { error: 0, warning: 0, info: 0 };
  const out: AuditDesignOutput["artboards"] = [];
  for (const ab of targets) {
    if (!ab.design) {
      out.push({ artboardId: ab.id, artboardName: ab.name, issues: [] });
      continue;
    }
    const issues = auditTree(ab.design);
    for (const issue of issues) summary[issue.severity] += 1;
    out.push({ artboardId: ab.id, artboardName: ab.name, issues });
  }
  return ok({
    artboards: out,
    totalIssues: summary.error + summary.warning + summary.info,
    summary,
  });
}

/* ─── arrange_artboards ────────────────────────────────── */

export interface ArrangeArtboardsInput {
  strategy: ArrangeStrategy;
  /** Restrict to these artboards; defaults to all. */
  artboardIds?: string[];
  gap?: number;
  originX?: number;
  originY?: number;
  idempotencyKey?: string;
}

export function executeArrangeArtboards(
  input: ArrangeArtboardsInput,
): ToolResult<{
  movedArtboardIds: string[];
}> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const all = state.artboards;
    const targets = input.artboardIds
      ? all.filter((a) => input.artboardIds!.includes(a.id))
      : all;
    if (targets.length === 0) {
      return fail("not_found", "No matching artboards to arrange.");
    }
    // Default origin = top-left of the current cluster so the tidy-up
    // doesn't yank the camera to (0,0) for users with a busy canvas.
    const ox =
      input.originX ??
      Math.min(...targets.map((a) => a.x));
    const oy =
      input.originY ??
      Math.min(...targets.map((a) => a.y));
    const positions = arrangeArtboards(targets, input.strategy, {
      gap: input.gap,
      originX: ox,
      originY: oy,
    });
    const movedArtboardIds: string[] = [];
    for (const id of Object.keys(positions)) {
      const ab = targets.find((a) => a.id === id);
      if (!ab) continue;
      // Skip locked artboards — the user pinned them in place.
      if (ab.locked) continue;
      const { x, y } = positions[id]!;
      if (x !== ab.x || y !== ab.y) {
        state.updateArtboard(id, { x, y });
        movedArtboardIds.push(id);
      }
    }
    return ok({ movedArtboardIds });
  });
}

/* ─── set_artboard_background ──────────────────────────── */

export interface SetArtboardBackgroundInput {
  artboardId: string;
  background: string;
  idempotencyKey?: string;
}

export function executeSetArtboardBackground(
  input: SetArtboardBackgroundInput,
): ToolResult<{ artboardId: string; background: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const state = useDesignCanvas.getState();
    const ab = state.artboards.find((a) => a.id === input.artboardId);
    if (!ab) return fail("not_found", `Artboard "${input.artboardId}" not found.`);
    state.updateArtboard(input.artboardId, { background: input.background });
    return ok({
      artboardId: input.artboardId,
      background: input.background,
    });
  });
}

/* ─── diff_artboards ──────────────────────────────────── */

export interface DiffArtboardsInput {
  artboardIdA: string;
  artboardIdB: string;
}

export interface DiffEntry {
  kind: "added" | "removed" | "modified";
  path: string;
  nodeIdA: string | null;
  nodeIdB: string | null;
  summary: string;
}

export interface DiffArtboardsOutput {
  summary: string;
  additions: number;
  removals: number;
  modifications: number;
  entries: DiffEntry[];
}

function childrenOf(node: DesignNode): DesignNode[] {
  if (node.type === "div" || node.type === "section" || node.type === "nav" || node.type === "card" || node.type === "frame") {
    return (node as { children?: DesignNode[] }).children ?? [];
  }
  return [];
}

function nodeSignature(node: DesignNode): string {
  const parts: string[] = [node.type];
  if (node.type === "text") parts.push(`text=${(node as { text: string }).text}`);
  if (node.type === "button") parts.push(`label=${(node as { label: string }).label}`);
  if (node.type === "link") parts.push(`label=${(node as { label: string }).label}`);
  if (node.type === "icon") parts.push(`name=${(node as { name: string }).name}`);
  if (node.type === "image") parts.push(`src=${(node as { src?: string }).src ?? ""}`);
  if (node.style) parts.push(`style=${JSON.stringify(node.style)}`);
  return parts.join("|");
}

function describeNode(node: DesignNode): string {
  if (node.type === "text") return `"${(node as { text: string }).text.slice(0, 40)}"`;
  if (node.type === "button") return `button "${(node as { label: string }).label}"`;
  if (node.type === "link") return `link "${(node as { label: string }).label}"`;
  if (node.type === "image") return `image (${(node as { src?: string }).src ?? "placeholder"})`;
  if (node.type === "icon") return `icon "${(node as { name: string }).name}"`;
  if (node.type === "frame") {
    const title = (node as { title?: string }).title;
    return title ? `frame "${title}"` : "frame";
  }
  return node.type;
}

function walkDiff(
  a: DesignNode | null,
  b: DesignNode | null,
  path: string,
  out: DiffEntry[],
): void {
  if (a && !b) {
    out.push({
      kind: "removed",
      path,
      nodeIdA: a.id ?? null,
      nodeIdB: null,
      summary: `${describeNode(a)} removed`,
    });
    return;
  }
  if (!a && b) {
    out.push({
      kind: "added",
      path,
      nodeIdA: null,
      nodeIdB: b.id ?? null,
      summary: `${describeNode(b)} added`,
    });
    return;
  }
  if (!a || !b) return;

  if (a.type !== b.type) {
    out.push({
      kind: "modified",
      path,
      nodeIdA: a.id ?? null,
      nodeIdB: b.id ?? null,
      summary: `type changed: ${a.type} → ${b.type}`,
    });
  } else if (nodeSignature(a) !== nodeSignature(b)) {
    out.push({
      kind: "modified",
      path,
      nodeIdA: a.id ?? null,
      nodeIdB: b.id ?? null,
      summary: `${describeNode(a)} modified`,
    });
  }

  const aKids = childrenOf(a);
  const bKids = childrenOf(b);
  const max = Math.max(aKids.length, bKids.length);
  for (let i = 0; i < max; i++) {
    walkDiff(aKids[i] ?? null, bKids[i] ?? null, `${path}.children[${i}]`, out);
  }
}

export function executeDiffArtboards(
  input: DiffArtboardsInput,
): ToolResult<DiffArtboardsOutput> {
  const state = useDesignCanvas.getState();
  const a = state.artboards.find((ab) => ab.id === input.artboardIdA);
  const b = state.artboards.find((ab) => ab.id === input.artboardIdB);
  if (!a) return fail("not_found", `Artboard A "${input.artboardIdA}" not found.`);
  if (!b) return fail("not_found", `Artboard B "${input.artboardIdB}" not found.`);

  const entries: DiffEntry[] = [];
  walkDiff(a.design ?? null, b.design ?? null, "root", entries);

  const additions = entries.filter((e) => e.kind === "added").length;
  const removals = entries.filter((e) => e.kind === "removed").length;
  const modifications = entries.filter((e) => e.kind === "modified").length;

  const summary =
    entries.length === 0
      ? `No structural differences between "${a.name}" and "${b.name}".`
      : `${additions} added, ${removals} removed, ${modifications} modified.`;

  return ok({
    summary,
    additions,
    removals,
    modifications,
    entries,
  });
}

/* ─── export_jsx ──────────────────────────────────────── */

export interface ExportJsxInput {
  artboardId: string;
  target?: "react" | "html";
  indent?: "2" | "4" | "tab";
}

export interface ExportJsxOutput {
  artboardId: string;
  target: "react" | "html";
  code: string;
  nodeCount: number;
  lineCount: number;
}

const TAG_BY_TYPE: Record<string, string> = {
  div: "div",
  section: "section",
  nav: "nav",
  card: "div",
  frame: "div",
  text: "span",
  button: "button",
  image: "img",
  input: "input",
  icon: "span",
  link: "a",
  divider: "hr",
  "component-ref": "div",
};

function indentStr(level: number, kind: "2" | "4" | "tab"): string {
  if (kind === "tab") return "\t".repeat(level);
  return " ".repeat(Number(kind) * level);
}

function styleToString(
  style: Record<string, string | number> | undefined,
  target: "react" | "html",
): string | null {
  if (!style || Object.keys(style).length === 0) return null;
  if (target === "react") {
    const entries = Object.entries(style)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
      .join(", ");
    return `{{ ${entries} }}`;
  }
  const css = Object.entries(style)
    .map(([k, v]) => {
      const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const value = typeof v === "number" ? `${v}px` : v;
      return `${kebab}: ${value}`;
    })
    .join("; ");
  return `"${css.replace(/"/g, "&quot;")}"`;
}

function escapeText(text: string, target: "react" | "html"): string {
  if (target === "react") {
    return text.replace(/[<>{}]/g, (c) => `{${JSON.stringify(c)}}`);
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderNode(
  node: DesignNode,
  level: number,
  target: "react" | "html",
  indent: "2" | "4" | "tab",
  count: { n: number },
): string {
  if (node.hidden) return "";
  count.n += 1;
  const pad = indentStr(level, indent);
  const tag = TAG_BY_TYPE[node.type] ?? "div";
  const attrs: string[] = [];

  const styleAttr = styleToString(
    node.style as Record<string, string | number> | undefined,
    target,
  );
  const styleKey = target === "react" ? "style" : "style";
  if (styleAttr) attrs.push(`${styleKey}=${styleAttr}`);

  if (node.type === "image") {
    const src = (node as { src?: string }).src ?? "";
    const alt = (node as { alt?: string }).alt ?? "";
    if (src) attrs.push(`src=${JSON.stringify(src)}`);
    if (alt) attrs.push(`alt=${JSON.stringify(alt)}`);
    return `${pad}<img ${attrs.join(" ")} />`;
  }
  if (node.type === "input") {
    const placeholder = (node as { placeholder?: string }).placeholder;
    const inputType = (node as { inputType?: string }).inputType ?? "text";
    attrs.push(`type=${JSON.stringify(inputType)}`);
    if (placeholder) attrs.push(`placeholder=${JSON.stringify(placeholder)}`);
    return `${pad}<input ${attrs.join(" ")} />`;
  }
  if (node.type === "divider") {
    return `${pad}<hr ${attrs.join(" ")} />`;
  }
  if (node.type === "text") {
    const t = (node as { text: string; tag?: string }).text;
    const semantic = (node as { tag?: string }).tag ?? "span";
    const inner = escapeText(t, target);
    return `${pad}<${semantic} ${attrs.join(" ")}>${inner}</${semantic}>`;
  }
  if (node.type === "button") {
    const label = (node as { label: string }).label;
    return `${pad}<button ${attrs.join(" ")}>${escapeText(label, target)}</button>`;
  }
  if (node.type === "link") {
    const label = (node as { label: string }).label;
    const href = (node as { href?: string }).href;
    if (href) attrs.push(`href=${JSON.stringify(href)}`);
    return `${pad}<a ${attrs.join(" ")}>${escapeText(label, target)}</a>`;
  }
  if (node.type === "icon") {
    const name = (node as { name: string }).name;
    const aria = `aria-label=${JSON.stringify(name)}`;
    return `${pad}<span ${aria} ${attrs.join(" ")}>{/* icon: ${name} */}</span>`;
  }
  if (node.type === "component-ref") {
    const slug = (node as { componentSlug: string }).componentSlug;
    return `${pad}<div ${attrs.join(" ")}>{/* component-ref: ${slug} */}</div>`;
  }

  const kids = childrenOf(node);
  const opening = `${pad}<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  if (kids.length === 0) {
    return `${opening}</${tag}>`;
  }
  const renderedKids = kids
    .map((c) => renderNode(c, level + 1, target, indent, count))
    .filter(Boolean)
    .join("\n");
  return `${opening}\n${renderedKids}\n${pad}</${tag}>`;
}

export function executeExportJsx(
  input: ExportJsxInput,
): ToolResult<ExportJsxOutput> {
  const state = useDesignCanvas.getState();
  const ab = state.artboards.find((a) => a.id === input.artboardId);
  if (!ab) {
    return fail(
      "not_found",
      `Artboard "${input.artboardId}" not found.`,
      "Call query_canvas to refresh artboard ids.",
    );
  }
  if (!ab.design) {
    return fail(
      "preconditions_failed",
      "Artboard has no design tree yet — nothing to export.",
      "Add at least one node before exporting.",
    );
  }
  const target = input.target ?? "react";
  const indent = input.indent ?? "2";
  const count = { n: 0 };
  const code = renderNode(ab.design, 0, target, indent, count);

  return ok({
    artboardId: input.artboardId,
    target,
    code,
    nodeCount: count.n,
    lineCount: code.split("\n").length,
  });
}

/* ─── find_and_replace ────────────────────────────────── */

export interface FindAndReplaceInput {
  find: string;
  replace: string;
  scope?: "text" | "style" | "both";
  artboardId?: string;
}

export interface FindAndReplaceOutput {
  totalMatched: number;
  totalReplaced: number;
  perArtboard: Array<{
    artboardId: string;
    artboardName: string;
    matched: number;
    replaced: number;
  }>;
}

/** Fields that carry user-visible text content. */
const TEXT_FIELDS = [
  "text",
  "label",
  "placeholder",
  "alt",
  "title",
  "href",
  "src",
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

function getTextField(node: DesignNode, key: TextField): string | undefined {
  const n = node as unknown as Record<string, unknown>;
  const v = n[key];
  return typeof v === "string" ? v : undefined;
}

function setTextField(
  node: DesignNode,
  key: TextField,
  value: string,
): DesignNode {
  return { ...node, [key]: value } as DesignNode;
}

function searchTextInNode(node: DesignNode, find: string): number {
  let hits = 0;
  for (const key of TEXT_FIELDS) {
    const val = getTextField(node, key);
    if (val !== undefined && val.includes(find)) hits += 1;
  }
  return hits;
}

function replaceTextInNode(node: DesignNode, find: string, replace: string): DesignNode {
  let n = node;
  for (const key of TEXT_FIELDS) {
    const val = getTextField(n, key);
    if (val !== undefined && val.includes(find)) {
      n = setTextField(n, key, val.split(find).join(replace));
    }
  }
  return n;
}

function searchStyleInNode(node: DesignNode, find: string): number {
  if (!node.style) return 0;
  let hits = 0;
  for (const v of Object.values(node.style)) {
    if (typeof v === "string" && v.includes(find)) hits += 1;
  }
  return hits;
}

function replaceStyleInNode(node: DesignNode, find: string, replace: string): DesignNode {
  if (!node.style) return node;
  const nextStyle: Record<string, string | number> = {};
  let changed = false;
  for (const [k, v] of Object.entries(node.style)) {
    if (typeof v === "string" && v.includes(find)) {
      nextStyle[k] = v.split(find).join(replace);
      changed = true;
    } else {
      nextStyle[k] = v;
    }
  }
  return changed ? { ...node, style: nextStyle } : node;
}

function findAndReplaceTree(
  node: DesignNode,
  find: string,
  replace: string,
  scope: "text" | "style" | "both",
): { tree: DesignNode; matched: number; replaced: number } {
  let matched = 0;
  let replaced = 0;
  let n = node;

  if (scope === "text" || scope === "both") {
    const hits = searchTextInNode(n, find);
    if (hits > 0) {
      matched += hits;
      replaced += hits;
      n = replaceTextInNode(n, find, replace);
    }
  }

  if (scope === "style" || scope === "both") {
    const hits = searchStyleInNode(n, find);
    if (hits > 0) {
      matched += hits;
      replaced += hits;
      n = replaceStyleInNode(n, find, replace);
    }
  }

  const kids = childrenOf(n);
  if (kids.length > 0) {
    const newKids: DesignNode[] = [];
    for (const child of kids) {
      const r = findAndReplaceTree(child, find, replace, scope);
      matched += r.matched;
      replaced += r.replaced;
      newKids.push(r.tree);
    }
    n = { ...n, children: newKids } as DesignNode;
  }

  return { tree: n, matched, replaced };
}

export function executeFindAndReplace(
  input: FindAndReplaceInput,
): ToolResult<FindAndReplaceOutput> {
  const state = useDesignCanvas.getState();
  const scope = input.scope ?? "both";
  const targets = input.artboardId
    ? state.artboards.filter((a) => a.id === input.artboardId)
    : state.artboards;

  if (input.artboardId && targets.length === 0) {
    return fail("not_found", `Artboard "${input.artboardId}" not found.`);
  }

  let totalMatched = 0;
  let totalReplaced = 0;
  const perArtboard: FindAndReplaceOutput["perArtboard"] = [];

  for (const ab of targets) {
    if (!ab.design) {
      perArtboard.push({
        artboardId: ab.id,
        artboardName: ab.name,
        matched: 0,
        replaced: 0,
      });
      continue;
    }
    const r = findAndReplaceTree(ab.design, input.find, input.replace, scope);
    totalMatched += r.matched;
    totalReplaced += r.replaced;
    perArtboard.push({
      artboardId: ab.id,
      artboardName: ab.name,
      matched: r.matched,
      replaced: r.replaced,
    });
    if (r.replaced > 0) {
      state.updateArtboard(ab.id, { design: r.tree });
    }
  }

  return ok({ totalMatched, totalReplaced, perArtboard });
}

/* ─── analyze_consistency ──────────────────────────────── */

export interface AnalyzeConsistencyOutput {
  issues: Array<{
    category: string;
    severity: "error" | "warning" | "info";
    message: string;
    occurrences: number;
    values: Array<{ value: string; count: number }>;
  }>;
  totalIssues: number;
}

interface ValueBucket {
  value: string;
  count: number;
  sampleNodeType: string;
}

function walkCollectValues(
  node: DesignNode,
  buckets: Map<string, Map<string, ValueBucket>>,
): void {
  if (node.style) {
    for (const [k, v] of Object.entries(node.style)) {
      const bucketKey = k;
      const strVal = String(v);
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
      const map = buckets.get(bucketKey)!;
      const existing = map.get(strVal);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(strVal, { value: strVal, count: 1, sampleNodeType: node.type });
      }
    }
  }

  // Collect button heights separately
  if (node.type === "button" && node.style?.height !== undefined) {
    const key = "buttonHeight";
    const strVal = String(node.style.height);
    if (!buckets.has(key)) buckets.set(key, new Map());
    const map = buckets.get(key)!;
    const existing = map.get(strVal);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(strVal, { value: strVal, count: 1, sampleNodeType: "button" });
    }
  }

  // Collect accent-like colors
  if (node.style?.backgroundColor !== undefined) {
    const val = String(node.style.backgroundColor);
    if (looksLikeColor(val) && !looksLikeNeutral(val)) {
      const key = "accentBackgroundColor";
      if (!buckets.has(key)) buckets.set(key, new Map());
      const map = buckets.get(key)!;
      const existing = map.get(val);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(val, { value: val, count: 1, sampleNodeType: node.type });
      }
    }
  }

  for (const child of childrenOf(node)) {
    walkCollectValues(child, buckets);
  }
}

function looksLikeColor(value: string): boolean {
  return (
    value.startsWith("#") ||
    value.startsWith("rgb") ||
    value.startsWith("hsl") ||
    value.startsWith("var(")
  );
}

function looksLikeNeutral(value: string): boolean {
  const lowered = value.toLowerCase();
  const neutrals = [
    "transparent",
    "white",
    "black",
    "#000",
    "#fff",
    "#ffffff",
    "#000000",
  ];
  if (neutrals.some((n) => lowered === n || lowered.startsWith(n))) return true;
  // zinc / gray / slate / neutral / stone families
  if (/\b(zinc|gray|slate|neutral|stone)\b/.test(lowered)) return true;
  // near-neutral hexes (first two channels almost equal)
  if (lowered.startsWith("#") && lowered.length >= 4) {
    const r = parseInt(lowered.slice(1, 3), 16);
    const g = parseInt(lowered.slice(3, 5), 16);
    const b = parseInt(lowered.slice(5, 7), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
      if (maxDiff < 16) return true;
    }
  }
  return false;
}

function buildConsistencyIssues(
  buckets: Map<string, Map<string, ValueBucket>>,
): AnalyzeConsistencyOutput["issues"] {
  const issues: AnalyzeConsistencyOutput["issues"] = [];

  const categories: Array<{
    key: string | string[];
    name: string;
    threshold: number;
    severity: "error" | "warning" | "info";
    message: (unique: number, vals: ValueBucket[]) => string;
  }> = [
    {
      key: "borderRadius",
      name: "border radius",
      threshold: 2,
      severity: "warning",
      message: (u) =>
        `${u} different border radii found — tokens should govern this`,
    },
    {
      key: "buttonHeight",
      name: "button height",
      threshold: 2,
      severity: "error",
      message: (u) =>
        `${u} different button heights — every primary action should share one height`,
    },
    {
      key: "accentBackgroundColor",
      name: "accent color",
      threshold: 2,
      severity: "error",
      message: (u) =>
        `${u} different accent backgrounds — consolidate to one token`,
    },
    {
      key: "fontSize",
      name: "font size",
      threshold: 4,
      severity: "warning",
      message: (u) =>
        `${u} different font sizes — use the type scale (12/14/16/18/24/32/48/72)`,
    },
    {
      key: "padding",
      name: "padding",
      threshold: 4,
      severity: "info",
      message: (u) =>
        `${u} different padding values — prefer the spacing scale (4/8/12/16/24/32/48/64/96)`,
    },
    {
      key: "gap",
      name: "gap",
      threshold: 3,
      severity: "info",
      message: (u) =>
        `${u} different gap values — prefer the spacing scale`,
    },
    {
      key: "fontFamily",
      name: "font family",
      threshold: 2,
      severity: "error",
      message: (u) =>
        `${u} different font families — pick one and tokenize it`,
    },
  ];

  for (const cat of categories) {
    const keys = Array.isArray(cat.key) ? cat.key : [cat.key];
    const merged = new Map<string, ValueBucket>();
    for (const k of keys) {
      const map = buckets.get(k);
      if (!map) continue;
      for (const [val, bucket] of map) {
        const existing = merged.get(val);
        if (existing) {
          existing.count += bucket.count;
        } else {
          merged.set(val, { ...bucket });
        }
      }
    }
    if (merged.size >= cat.threshold) {
      const values = Array.from(merged.values()).sort((a, b) => b.count - a.count);
      const occurrences = values.reduce((sum, v) => sum + v.count, 0);
      issues.push({
        category: cat.name,
        severity: cat.severity,
        message: cat.message(merged.size, values),
        occurrences,
        values: values.map((v) => ({ value: v.value, count: v.count })),
      });
    }
  }

  // Sort by severity: error > warning > info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.occurrences - a.occurrences,
  );

  return issues;
}

export function executeAnalyzeConsistency(): ToolResult<AnalyzeConsistencyOutput> {
  const state = useDesignCanvas.getState();
  const buckets = new Map<string, Map<string, ValueBucket>>();

  for (const ab of state.artboards) {
    if (!ab.design) continue;
    walkCollectValues(ab.design, buckets);
  }

  const issues = buildConsistencyIssues(buckets);
  return ok({ issues, totalIssues: issues.length });
}

/* ─── suggest_components ─────────────────────────────── */

export interface SuggestComponentsInput {
  minOccurrences?: number;
  minNodeCount?: number;
}

export interface SuggestComponentsOutput {
  suggestions: Array<{
    name: string;
    occurrences: number;
    nodeCount: number;
    estimatedSavings: number;
    examplePath: string;
  }>;
}

/** Structural fingerprint that ignores text content but keeps type
 *  hierarchy, style keys, and a few semantic props. */
function structuralFingerprint(node: DesignNode): string {
  const styleKeys = node.style ? Object.keys(node.style).sort().join(",") : "";
  let base = `${node.type}|sk=[${styleKeys}]`;

  const n = node as unknown as Record<string, unknown>;
  if (node.type === "text") base += `|tag=${(n.tag as string) || "span"}`;
  if (node.type === "button")
    base += `|variant=${(n.variant as string) || "primary"}|size=${(n.size as string) || "md"}`;
  if (node.type === "image") base += `|hasSrc=${!!n.src}`;
  if (node.type === "input")
    base += `|type=${(n.inputType as string) || "text"}`;
  if (node.type === "link") base += `|hasHref=${!!n.href}`;
  if (node.type === "icon") base += `|name=${n.name}`;
  if (node.type === "frame") base += `|hasTitle=${!!n.title}`;
  if (node.type === "component-ref")
    base += `|slug=${n.componentSlug}`;

  const kids = childrenOf(node);
  if (kids.length > 0) {
    base += `|c=[${kids.map(structuralFingerprint).join("][")}]`;
  }
  return base;
}

function countNodesDeep(node: DesignNode): number {
  let n = 1;
  for (const c of childrenOf(node)) n += countNodesDeep(c);
  return n;
}

function collectSubtrees(
  node: DesignNode,
  path: string,
  out: Array<{ node: DesignNode; fingerprint: string; nodeCount: number; path: string }>,
): void {
  const fp = structuralFingerprint(node);
  const nc = countNodesDeep(node);
  out.push({ node, fingerprint: fp, nodeCount: nc, path });
  for (let i = 0; i < childrenOf(node).length; i++) {
    collectSubtrees(
      childrenOf(node)[i]!,
      `${path}.children[${i}]`,
      out,
    );
  }
}

function guessComponentName(node: DesignNode): string {
  const n = node as unknown as Record<string, unknown>;
  if (node.type === "card") return "Card";
  if (node.type === "nav") return "Navbar";
  if (node.type === "section") {
    const heading = childrenOf(node).find(
      (c) =>
        c.type === "text" &&
        (c as unknown as { tag?: string }).tag?.startsWith("h"),
    );
    const title =
      (heading && (heading as unknown as { text?: string }).text?.slice(0, 20)) ??
      "";
    return title ? `"${title}" Section` : "Section";
  }
  if (node.type === "frame") {
    const t = (n.title as string) || "";
    return t ? `"${t}" Frame` : "Frame";
  }
  if (node.type === "button") return `Button ${(n.label as string) || ""}`.trim();
  if (node.type === "div") {
    const firstButton = childrenOf(node).find((c) => c.type === "button");
    if (firstButton) return `CTA Group`;
    const firstText = childrenOf(node).find((c) => c.type === "text");
    if (firstText) return `Text Block`;
    return "Container";
  }
  if (node.type === "component-ref") return `Ref ${n.componentSlug}`;
  return `${node.type.charAt(0).toUpperCase()}${node.type.slice(1)}`;
}

export function executeSuggestComponents(
  input: SuggestComponentsInput,
): ToolResult<SuggestComponentsOutput> {
  const state = useDesignCanvas.getState();
  const minOccurrences = input.minOccurrences ?? 2;
  const minNodeCount = input.minNodeCount ?? 3;

  const allSubtrees: Array<{
    fingerprint: string;
    nodeCount: number;
    path: string;
    artboardName: string;
  }> = [];

  for (const ab of state.artboards) {
    if (!ab.design) continue;
    const local: Array<{
      node: DesignNode;
      fingerprint: string;
      nodeCount: number;
      path: string;
    }> = [];
    collectSubtrees(ab.design, "root", local);
    for (const s of local) {
      allSubtrees.push({
        fingerprint: s.fingerprint,
        nodeCount: s.nodeCount,
        path: `${ab.name}:${s.path}`,
        artboardName: ab.name,
      });
    }
  }

  // Group by fingerprint
  const groups = new Map<
    string,
    Array<{ nodeCount: number; path: string; artboardName: string }>
  >();
  for (const s of allSubtrees) {
    const g = groups.get(s.fingerprint);
    if (g) {
      g.push({ nodeCount: s.nodeCount, path: s.path, artboardName: s.artboardName });
    } else {
      groups.set(s.fingerprint, [
        { nodeCount: s.nodeCount, path: s.path, artboardName: s.artboardName },
      ]);
    }
  }

  // Resolve fingerprint -> representative node for naming
  const fingerprintToNode = new Map<string, DesignNode>();
  for (const ab of state.artboards) {
    if (!ab.design) continue;
    const local: Array<{
      node: DesignNode;
      fingerprint: string;
      nodeCount: number;
      path: string;
    }> = [];
    collectSubtrees(ab.design, "root", local);
    for (const s of local) {
      if (!fingerprintToNode.has(s.fingerprint)) {
        fingerprintToNode.set(s.fingerprint, s.node);
      }
    }
  }

  const suggestions: SuggestComponentsOutput["suggestions"] = [];
  for (const [fp, entries] of groups) {
    if (entries.length < minOccurrences) continue;
    const nc = entries[0]?.nodeCount ?? 0;
    if (nc < minNodeCount) continue;
    const rep = fingerprintToNode.get(fp);
    const name = rep ? guessComponentName(rep) : "Component";
    const estimatedSavings = nc * (entries.length - 1); // nodes saved if extracted
    suggestions.push({
      name,
      occurrences: entries.length,
      nodeCount: nc,
      estimatedSavings,
      examplePath: entries[0]?.path ?? "",
    });
  }

  // Rank by estimated savings (highest first), then occurrences
  suggestions.sort((a, b) =>
    b.estimatedSavings !== a.estimatedSavings
      ? b.estimatedSavings - a.estimatedSavings
      : b.occurrences - a.occurrences,
  );

  // Cap at top 10
  const capped = suggestions.slice(0, 10);
  return ok({ suggestions: capped });
}

/* ─── set_grid ───────────────────────────────────────── */

export interface SetGridInput {
  artboardId: string;
  columns: number;
  gutter: number;
  margin: number;
  color?: string;
}

export interface SetGridOutput {
  artboardId: string;
  grid: {
    columns: number;
    gutter: number;
    margin: number;
    color: string;
  };
}

export function executeSetGrid(
  input: SetGridInput,
): ToolResult<SetGridOutput> {
  const state = useDesignCanvas.getState();
  const ab = state.artboards.find((a) => a.id === input.artboardId);
  if (!ab) {
    return fail("not_found", `Artboard "${input.artboardId}" not found.`);
  }
  const grid = {
    columns: input.columns,
    gutter: input.gutter,
    margin: input.margin,
    color: input.color ?? "rgba(161, 161, 170, 0.15)",
  };
  state.updateArtboard(input.artboardId, { grid });
  return ok({ artboardId: input.artboardId, grid });
}

/* ─── helpers ──────────────────────────────────────── */

// Re-exported so the chat can ask "is this id even in the tree?" before
// dispatching multi-node tools — currently unused but kept here so the
// plural executors and any future inspector code can share the import.
export { findNodeInTree };
