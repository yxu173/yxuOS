/**
 * Higher-level operations layered on top of `node-utils.ts`. Each helper
 * here implements one of the "world-class designer" tools the agent
 * exposes — wrap / unwrap / replace / align / distribute / audit /
 * arrange — and returns a pure, immutable result so the canvas store
 * can swap it in with a single `updateArtboard` call.
 */

import { nanoid } from "nanoid";

import type { DesignNode } from "./design-node";
import {
  ensureIds,
  findNodeInTree,
  findParentInTree,
  hasChildren,
  patchNodeInTree,
} from "./node-utils";

/* ─── shared types ─────────────────────────────────────── */

export interface OpError {
  message: string;
  hint?: string;
}

const newNodeId = () => `n_${nanoid(8)}`;

/**
 * Internal: replace a container's children via a transformer. Mirrors
 * the helper in `node-utils.ts` (kept private there) but exposed here
 * for the higher-level ops without forcing an export-surface change.
 */
function updateContainerChildren(
  node: DesignNode,
  targetId: string,
  transform: (children: DesignNode[]) => DesignNode[],
): DesignNode | null {
  if (node.id === targetId) {
    if (!hasChildren(node)) return null;
    const nextChildren = transform(node.children ?? []);
    return { ...node, children: nextChildren } as DesignNode;
  }
  if (!hasChildren(node) || !node.children) return null;
  for (let i = 0; i < node.children.length; i++) {
    const updated = updateContainerChildren(
      node.children[i]!,
      targetId,
      transform,
    );
    if (updated) {
      const nextChildren = node.children.slice();
      nextChildren[i] = updated;
      return { ...node, children: nextChildren } as DesignNode;
    }
  }
  return null;
}

/* ─── wrap / unwrap / replace ──────────────────────────── */

/**
 * Wrap N **adjacent** siblings of the same parent in a fresh container.
 * All wrapped ids must share a single parent and form a contiguous run
 * in that parent's children array — if they don't, the operation fails
 * (unambiguous semantics > clever heuristics).
 *
 * The new container takes the position of the first wrapped sibling.
 */
export function wrapNodesInTree(
  root: DesignNode,
  nodeIds: string[],
  containerType: "div" | "section" | "card" | "frame" | "nav",
  style?: Record<string, string | number>,
):
  | { tree: DesignNode; containerId: string; wrappedNodeIds: string[] }
  | { error: OpError } {
  if (nodeIds.length === 0) {
    return { error: { message: "`nodeIds` is empty — nothing to wrap." } };
  }
  if (nodeIds.includes(root.id ?? "")) {
    return {
      error: {
        message: "Can't wrap the artboard root.",
        hint: "Use `update_artboard` to reshape the root container.",
      },
    };
  }

  const firstParent = findParentInTree(root, nodeIds[0]!);
  if (!firstParent || !hasChildren(firstParent)) {
    return {
      error: {
        message: `Node "${nodeIds[0]}" not found.`,
        hint: "Call `find_nodes` or `get_artboard` for current ids.",
      },
    };
  }
  const kids: DesignNode[] = firstParent.children ?? [];
  const childIds = kids.map((c: DesignNode) => c.id ?? "");
  const indices: number[] = [];
  for (const id of nodeIds) {
    const idx = childIds.indexOf(id);
    if (idx < 0) {
      return {
        error: {
          message: `Node "${id}" doesn't share the parent of "${nodeIds[0]}".`,
          hint: "Only adjacent siblings of one parent can be wrapped together.",
        },
      };
    }
    indices.push(idx);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) {
      return {
        error: {
          message: "Wrapped nodes must be contiguous siblings.",
          hint: "Reorder with `move_nodes` first, then wrap.",
        },
      };
    }
  }

  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  const slice = kids.slice(start, end + 1);
  const containerId = newNodeId();
  const container = {
    id: containerId,
    type: containerType,
    children: slice,
    ...(style ? { style } : {}),
  } as DesignNode;

  const tree = updateContainerChildren(
    root,
    firstParent.id ?? "",
    (children) => {
      const before = children.slice(0, start);
      const after = children.slice(end + 1);
      return [...before, container, ...after];
    },
  );
  if (!tree) return { error: { message: "Failed to wrap nodes." } };
  return {
    tree,
    containerId,
    wrappedNodeIds: slice.map((c) => c.id ?? "").filter(Boolean),
  };
}

/**
 * Remove a container and reparent its children at the container's
 * position. Refuses to unwrap the artboard root or a leaf.
 */
export function unwrapNodeInTree(
  root: DesignNode,
  nodeId: string,
):
  | { tree: DesignNode; promotedNodeIds: string[] }
  | { error: OpError } {
  if (root.id === nodeId) {
    return {
      error: {
        message: "Can't unwrap the artboard root.",
        hint: "Use `update_artboard` to restructure.",
      },
    };
  }
  const target = findNodeInTree(root, nodeId);
  if (!target) {
    return {
      error: {
        message: `Node "${nodeId}" not found.`,
        hint: "Call `find_nodes` or `get_artboard` for current ids.",
      },
    };
  }
  if (!hasChildren(target)) {
    return {
      error: {
        message: `Node "${nodeId}" is a leaf (type="${target.type}") — nothing to unwrap.`,
        hint: "Use `delete_nodes` if you just want to remove it.",
      },
    };
  }
  const parent = findParentInTree(root, nodeId);
  if (!parent) {
    return { error: { message: `Parent of "${nodeId}" not found.` } };
  }
  const kids: DesignNode[] = target.children ?? [];
  const tree = updateContainerChildren(
    root,
    parent.id ?? "",
    (children) => {
      const idx = children.findIndex((c) => c.id === nodeId);
      if (idx < 0) return children;
      return [
        ...children.slice(0, idx),
        ...kids,
        ...children.slice(idx + 1),
      ];
    },
  );
  if (!tree) return { error: { message: "Failed to unwrap." } };
  return {
    tree,
    promotedNodeIds: kids.map((c) => c.id ?? "").filter(Boolean),
  };
}

/**
 * Atomic subtree swap. Replaces the node at `nodeId` (and its entire
 * subtree) with `replacement`. Refuses to replace the artboard root —
 * use `update_artboard` for that. The replacement is run through
 * `ensureIds` so every node ends up with a stable id.
 */
export function replaceNodeInTree(
  root: DesignNode,
  nodeId: string,
  replacement: DesignNode,
): { tree: DesignNode; newNodeId: string } | null {
  if (root.id === nodeId) return null;
  const fresh = ensureIds(replacement);
  function walk(node: DesignNode): DesignNode | null {
    if (!hasChildren(node) || !node.children) return null;
    const idx = node.children.findIndex((c) => c.id === nodeId);
    if (idx >= 0) {
      const next = node.children.slice();
      next[idx] = fresh;
      return { ...node, children: next } as DesignNode;
    }
    for (let i = 0; i < node.children.length; i++) {
      const updated = walk(node.children[i]!);
      if (updated) {
        const next = node.children.slice();
        next[i] = updated;
        return { ...node, children: next } as DesignNode;
      }
    }
    return null;
  }
  const tree = walk(root);
  if (!tree) return null;
  return { tree, newNodeId: fresh.id ?? "" };
}

/* ─── visibility ──────────────────────────────────────── */

/**
 * Toggle the `hidden` flag on one node. Hidden nodes stay in the tree
 * but are skipped by the renderer. Returns null on miss.
 */
export function setNodeHiddenInTree(
  root: DesignNode,
  nodeId: string,
  hidden: boolean,
): DesignNode | null {
  if (root.id === nodeId) {
    return { ...root, hidden } as DesignNode;
  }
  if (!hasChildren(root) || !root.children) return null;
  for (let i = 0; i < root.children.length; i++) {
    const patched = setNodeHiddenInTree(root.children[i]!, nodeId, hidden);
    if (patched) {
      const next = root.children.slice();
      next[i] = patched;
      return { ...root, children: next } as DesignNode;
    }
  }
  return null;
}

/* ─── alignment / distribution ─────────────────────────── */

export type AlignMode = "start" | "center" | "end" | "stretch";
export type DistributeMode =
  | "space-between"
  | "space-around"
  | "space-evenly";

/**
 * Apply `alignSelf` (cross-axis) to each target so they read as
 * aligned inside their flex parent. Missing ids are skipped.
 */
export function alignNodesInTree(
  root: DesignNode,
  nodeIds: string[],
  mode: AlignMode,
): { tree: DesignNode; patchedNodeIds: string[] } {
  const flexValue =
    mode === "start"
      ? "flex-start"
      : mode === "end"
        ? "flex-end"
        : mode;
  let tree = root;
  const patched: string[] = [];
  for (const id of nodeIds) {
    const next = patchNodeInTree(tree, id, {
      style: { alignSelf: flexValue },
    });
    if (next) {
      tree = next;
      patched.push(id);
    }
  }
  return { tree, patchedNodeIds: patched };
}

/**
 * Distribute children of a parent via `justifyContent`. Parent-side
 * only — doesn't touch the children's own styles.
 */
export function distributeChildrenInTree(
  root: DesignNode,
  parentId: string,
  mode: DistributeMode,
): DesignNode | null {
  const parent = findNodeInTree(root, parentId);
  if (!parent || !hasChildren(parent)) return null;
  return patchNodeInTree(root, parentId, {
    style: { justifyContent: mode, display: "flex" },
  });
}

/* ─── design audit ─────────────────────────────────────── */

export type AuditSeverity = "error" | "warning" | "info";

export interface AuditIssue {
  code: string;
  severity: AuditSeverity;
  nodeId: string | null;
  message: string;
  hint?: string;
}

const PLACEHOLDER_COPY_RE =
  /^(lorem ipsum|placeholder|click here|button( \d+)?|user( \d+)?|header( \d+)?|title|heading|text here|tbd|todo|coming soon|\.\.\.)/i;

function relativeLuminance(hex: string): number | null {
  let h = hex.trim();
  if (!h.startsWith("#")) return null;
  h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return null;
  const ch = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(fg: string, bg: string): number | null {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  if (L1 === null || L2 === null) return null;
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function styleNum(
  node: DesignNode,
  key: string,
): number | undefined {
  const s = (node as { style?: Record<string, unknown> }).style;
  const v = s?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /^(-?\d+(\.\d+)?)px?$/.exec(v);
    if (m) return parseFloat(m[1]!);
  }
  return undefined;
}

/**
 * Critique a tree against the agent's design rules. Returns a flat
 * list of `{ code, severity, nodeId, message, hint }` the agent can
 * sort by severity and bulk-fix with `patch_nodes`.
 */
export function auditTree(root: DesignNode): AuditIssue[] {
  const issues: AuditIssue[] = [];
  let h1Count = 0;

  function nearestBg(stack: DesignNode[]): string | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = (stack[i] as { style?: Record<string, unknown> }).style;
      const bg = s?.backgroundColor as string | undefined;
      if (typeof bg === "string" && bg.startsWith("#")) return bg;
      if (stack[i]!.type === "card") return "#ffffff";
    }
    return "#ffffff";
  }

  function walk(node: DesignNode, stack: DesignNode[]) {
    if (node.hidden) return; // skip subtree — hidden in render
    const id = node.id ?? null;

    if (node.type === "image") {
      if (!node.alt || node.alt.trim().length === 0) {
        issues.push({
          code: "missing-alt",
          severity: "warning",
          nodeId: id,
          message: "Image has no alt text.",
          hint: "patch_node with `alt: '…'` describing the image.",
        });
      }
    }

    if (node.type === "button") {
      const label = node.label ?? "";
      if (label.length > 30) {
        issues.push({
          code: "long-button-label",
          severity: "warning",
          nodeId: id,
          message: `Button label is ${label.length} chars — keep CTAs ≤ 30.`,
          hint: "Shorten the label or move detail to surrounding copy.",
        });
      }
      if (PLACEHOLDER_COPY_RE.test(label.trim())) {
        issues.push({
          code: "placeholder-copy",
          severity: "error",
          nodeId: id,
          message: `Button label looks like a placeholder: "${label}".`,
          hint: "Replace with real product copy.",
        });
      }
    }

    if (node.type === "text") {
      if (PLACEHOLDER_COPY_RE.test(node.text.trim())) {
        issues.push({
          code: "placeholder-copy",
          severity: "error",
          nodeId: id,
          message: `Text looks like a placeholder: "${node.text.slice(0, 40)}".`,
          hint: "Replace with real product copy.",
        });
      }
      if (node.tag === "h1") h1Count += 1;
      const fs = styleNum(node, "fontSize");
      if (fs !== undefined && fs < 12) {
        issues.push({
          code: "tiny-text",
          severity: "info",
          nodeId: id,
          message: `Text < 12px (${fs}px) — hard to read.`,
          hint: "Bump to 12+ unless this is intentional micro-copy.",
        });
      }
      const color = (node.style as { color?: string } | undefined)?.color;
      if (typeof color === "string" && color.startsWith("#")) {
        const bg = nearestBg(stack);
        if (bg) {
          const ratio = contrastRatio(color, bg);
          if (ratio !== null && ratio < 4.5) {
            issues.push({
              code: "low-contrast",
              severity: "warning",
              nodeId: id,
              message: `Contrast ratio ${ratio.toFixed(2)}:1 (fg ${color} on ${bg}) — below WCAG AA 4.5:1.`,
              hint: "Darken the text or lighten the background.",
            });
          }
        }
      }
    }

    if (node.type === "input") {
      if (!node.label && !node.placeholder) {
        issues.push({
          code: "bare-input",
          severity: "warning",
          nodeId: id,
          message: "Input has no label and no placeholder.",
          hint: "Add a `label` or at minimum a `placeholder`.",
        });
      }
    }

    if (node.type === "card") {
      const pad = styleNum(node, "padding");
      if (pad !== undefined && pad < 12) {
        issues.push({
          code: "cramped-card",
          severity: "info",
          nodeId: id,
          message: `Card padding ${pad}px is cramped.`,
          hint: "Bump padding to 16–24 for breathing room.",
        });
      }
    }

    if (hasChildren(node)) {
      const kids = node.children ?? [];
      if (
        kids.length === 0 &&
        node.type !== "frame" &&
        node !== root // a root-level empty container is the design's job
      ) {
        issues.push({
          code: "empty-container",
          severity: "info",
          nodeId: id,
          message: `Empty ${node.type} — add content or delete.`,
        });
      }
      const nextStack = [...stack, node];
      for (const child of kids) walk(child, nextStack);
    }
  }

  walk(root, []);

  if (h1Count > 1) {
    issues.push({
      code: "duplicate-h1",
      severity: "warning",
      nodeId: null,
      message: `Artboard has ${h1Count} h1 headings — expected exactly one.`,
      hint: "Demote secondary headings to h2.",
    });
  }

  return issues;
}

/* ─── artboard arrangement ─────────────────────────────── */

export type ArrangeStrategy = "grid" | "row" | "column";

export interface ArtboardLike {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Re-layout artboards into a tidy grid / row / column. Returns the
 * new positions per id; the caller writes them via `updateArtboard`.
 *
 * - `row`:    horizontal line, left→right, configurable gap.
 * - `column`: vertical line, top→bottom, configurable gap.
 * - `grid`:   square-ish row-major grid; row height = max in row.
 */
export function arrangeArtboards(
  artboards: ArtboardLike[],
  strategy: ArrangeStrategy,
  options?: { gap?: number; originX?: number; originY?: number },
): Record<string, { x: number; y: number }> {
  const gap = options?.gap ?? 80;
  const ox = options?.originX ?? 0;
  const oy = options?.originY ?? 0;
  const out: Record<string, { x: number; y: number }> = {};
  if (artboards.length === 0) return out;

  if (strategy === "row") {
    let cursor = ox;
    for (const ab of artboards) {
      out[ab.id] = { x: cursor, y: oy };
      cursor += ab.w + gap;
    }
    return out;
  }
  if (strategy === "column") {
    let cursor = oy;
    for (const ab of artboards) {
      out[ab.id] = { x: ox, y: cursor };
      cursor += ab.h + gap;
    }
    return out;
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(artboards.length)));
  let cursorY = oy;
  for (let i = 0; i < artboards.length; i += cols) {
    const row = artboards.slice(i, i + cols);
    let cursorX = ox;
    const rowHeight = Math.max(...row.map((a) => a.h));
    for (const ab of row) {
      out[ab.id] = { x: cursorX, y: cursorY };
      cursorX += ab.w + gap;
    }
    cursorY += rowHeight + gap;
  }
  return out;
}
