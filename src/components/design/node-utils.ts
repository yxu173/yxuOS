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
