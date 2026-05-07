import { nanoid } from "nanoid";

import type { DesignNode } from "./design-node";

/* ─── id assignment ────────────────────────────────────── */

const newNodeId = () => `n_${nanoid(8)}`;

/**
 * Walks a tree and assigns an `id` to any node that doesn't have one.
 * Returns a new tree (immutable). Existing ids are preserved.
 *
 * Called on every entry point that introduces a tree into the store
 * (`setArtboards`, `addArtboard`, `updateArtboard`, `updateArtboardDesign`)
 * so click-to-select / inspector edits always have a stable id to target.
 */
export function ensureIds(node: DesignNode): DesignNode {
  const next: DesignNode = {
    ...node,
    id: node.id ?? newNodeId(),
  } as DesignNode;
  if (hasChildren(node) && node.children) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any).children = node.children.map((child) => ensureIds(child));
  }
  return next;
}

function hasChildren(
  node: DesignNode,
): node is DesignNode & { children?: DesignNode[] } {
  return (
    node.type === "div" ||
    node.type === "section" ||
    node.type === "nav" ||
    node.type === "card" ||
    node.type === "frame"
  );
  // `component-ref` is treated as a leaf — its expansion happens at
  // render time, not in the persisted tree, so we don't recurse into
  // any expanded children here.
}

/* ─── tree traversal ──────────────────────────────────── */

/** Find a node by id anywhere in the subtree. Returns null if not found. */
export function findNodeInTree(
  node: DesignNode,
  targetId: string,
): DesignNode | null {
  if (node.id === targetId) return node;
  if (hasChildren(node) && node.children) {
    for (const child of node.children) {
      const found = findNodeInTree(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Patch a node by id with a shallow merge of `patch`. Returns a new tree
 * (immutable). If the id isn't found, the original tree is returned.
 */
export function updateNodeInTree(
  node: DesignNode,
  targetId: string,
  patch: Partial<DesignNode>,
): DesignNode {
  if (node.id === targetId) {
    return { ...node, ...patch } as DesignNode;
  }
  if (hasChildren(node) && node.children) {
    const newChildren = node.children.map((child) =>
      updateNodeInTree(child, targetId, patch),
    );
    return { ...node, children: newChildren } as DesignNode;
  }
  return node;
}

/** Delete a node by id. Returns the new tree, or null if the root itself
 *  was deleted. */
export function deleteNodeInTree(
  node: DesignNode,
  targetId: string,
): DesignNode | null {
  if (node.id === targetId) return null;
  if (hasChildren(node) && node.children) {
    const filtered = node.children
      .map((child) => deleteNodeInTree(child, targetId))
      .filter((child): child is DesignNode => child !== null);
    return { ...node, children: filtered } as DesignNode;
  }
  return node;
}

/* ─── surgical patch (agent / inspector) ──────────────── */

export interface NodePatch {
  /**
   * Shallow merge into the node's existing `style`. Set a key to `null`
   * to remove that style property (rare; usually a fresh value is what
   * you want).
   */
  style?: Record<string, string | number | null>;
  /** Replace `text` (text nodes). */
  text?: string;
  /** Replace `label` (button / link nodes). */
  label?: string;
  /** Replace `src` (image nodes). */
  src?: string;
  /** Replace `alt` (image nodes). */
  alt?: string;
  /** Replace `href` (link nodes). */
  href?: string;
  /** Replace `placeholder` (input nodes). */
  placeholder?: string;
  /** Replace `title` (frame nodes). */
  title?: string;
}

/**
 * Apply a partial update to a single node deep in the tree, returning a
 * new tree (immutable). The `style` key is shallow-merged so the agent
 * can change one CSS prop without having to re-emit the whole style
 * object. Other keys replace.
 *
 * Returns `null` if the target id is not in the tree — callers should
 * surface that as a tool error.
 */
export function patchNodeInTree(
  root: DesignNode,
  targetId: string,
  patch: NodePatch,
): DesignNode | null {
  if (root.id === targetId) return mergePatch(root, patch);

  if (hasChildren(root) && root.children) {
    for (let i = 0; i < root.children.length; i++) {
      const patched = patchNodeInTree(root.children[i], targetId, patch);
      if (patched) {
        const nextChildren = root.children.slice();
        nextChildren[i] = patched;
        return { ...root, children: nextChildren } as DesignNode;
      }
    }
  }
  return null;
}

function mergePatch(node: DesignNode, patch: NodePatch): DesignNode {
  const existingStyle =
    "style" in node && node.style ? node.style : undefined;
  const mergedStyle = patch.style
    ? (Object.fromEntries(
        Object.entries({ ...existingStyle, ...patch.style }).filter(
          // `null` (or `undefined`) clears the key — drop it entirely.
          ([, v]) => v !== null && v !== undefined,
        ),
      ) as DesignNode["style"])
    : existingStyle;

  const { style: _styleFromPatch, ...rest } = patch;
  void _styleFromPatch;
  return {
    ...node,
    ...rest,
    ...(mergedStyle ? { style: mergedStyle } : {}),
  } as DesignNode;
}
