import { nanoid } from "nanoid";

import type { DesignNode } from "./design-node";

/* ─── id assignment ────────────────────────────────────── */

const newNodeId = () => `n_${nanoid(8)}`;

/** Reassign every id in a subtree (used when duplicating / extracting). */
export function regenerateIds(node: DesignNode): DesignNode {
  const next: DesignNode = { ...node, id: newNodeId() } as DesignNode;
  if (hasChildren(node) && node.children) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any).children = node.children.map((child) => regenerateIds(child));
  }
  return next;
}

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

export function hasChildren(
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

/* ─── validation ───────────────────────────────────────── */

export const TREE_MAX_DEPTH = 24;
export const TREE_MAX_NODES = 1500;
export const TEXT_MAX_LENGTH = 4000;

export interface TreeValidationError {
  message: string;
  hint?: string;
}

/**
 * Structural validation for a DesignNode tree. Catches the failure modes
 * that produce broken-looking artboards (runaway depth from accidental
 * recursion, paragraphs of text 50 KB long, negative paddings) BEFORE the
 * tree hits the renderer. Returns the first violation, or null on success.
 */
export function validateTree(
  root: DesignNode,
): TreeValidationError | null {
  let count = 0;

  function walk(node: DesignNode, depth: number): TreeValidationError | null {
    count += 1;
    if (count > TREE_MAX_NODES) {
      return {
        message: `Tree exceeds the ${TREE_MAX_NODES}-node limit.`,
        hint: "Split the design across multiple artboards or reduce repeated content.",
      };
    }
    if (depth > TREE_MAX_DEPTH) {
      return {
        message: `Tree depth exceeds ${TREE_MAX_DEPTH} levels.`,
        hint: "Flatten nested containers — most layouts only need 6–8 levels.",
      };
    }

    if (node.type === "text") {
      if (typeof node.text !== "string" || node.text.length === 0) {
        return { message: "`text` node has empty or missing `text` field." };
      }
      if (node.text.length > TEXT_MAX_LENGTH) {
        return {
          message: `\`text\` node exceeds ${TEXT_MAX_LENGTH} characters.`,
          hint: "Move long-form prose to a markdown card or split into multiple text nodes.",
        };
      }
    }

    if (node.style && typeof node.style === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style = node.style as Record<string, any>;
      const pos = style.position;
      if (pos === "fixed" || pos === "sticky") {
        return {
          message: `Forbidden \`position: ${pos}\` on node id=${node.id ?? "<root>"}.`,
          hint: "Use `relative` or `absolute` (relative to the parent artboard) instead.",
        };
      }
      for (const key of [
        "padding",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
      ]) {
        const v = style[key];
        if (typeof v === "number" && v < 0) {
          return {
            message: `Negative \`${key}\` (${v}) on node id=${node.id ?? "<root>"}.`,
          };
        }
      }
    }

    if (hasChildren(node) && node.children) {
      for (const child of node.children) {
        const err = walk(child, depth + 1);
        if (err) return err;
      }
    }
    return null;
  }

  return walk(root, 0);
}

/* ─── search ───────────────────────────────────────────── */

export interface FindNodePredicate {
  type?: string;
  tag?: string;
  variant?: string;
  textIncludes?: string;
  hasStyleKey?: string;
}

export interface NodeMatch {
  id: string;
  type: string;
  depth: number;
  summary: string;
}

function _truncate(value: string, limit = 60): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function summarise(node: DesignNode): string {
  switch (node.type) {
    case "text":
      return `text/${node.tag ?? "span"}: "${_truncate(node.text)}"`;
    case "button":
      return `button/${node.variant ?? "primary"}: "${_truncate(node.label)}"`;
    case "link":
      return `link: "${_truncate(node.label)}"`;
    case "input":
      return `input: "${_truncate(node.placeholder ?? "")}"`;
    case "image":
      return `image: ${_truncate(node.alt ?? node.src ?? "")}`;
    case "frame":
      return `frame: "${_truncate(node.title ?? "")}"`;
    case "icon":
      return `icon: ${node.name}`;
    case "component-ref":
      return `component-ref: ${node.componentSlug}`;
    default:
      return node.type;
  }
}

function nodeMatches(
  node: DesignNode,
  predicate: FindNodePredicate,
): boolean {
  if (predicate.type && node.type !== predicate.type) return false;
  if (predicate.tag) {
    if (node.type !== "text" || node.tag !== predicate.tag) return false;
  }
  if (predicate.variant) {
    if (node.type !== "button" || node.variant !== predicate.variant) {
      return false;
    }
  }
  if (predicate.textIncludes) {
    const needle = predicate.textIncludes.toLowerCase();
    let haystack: string | undefined;
    if (node.type === "text") haystack = node.text;
    else if (node.type === "button" || node.type === "link") haystack = node.label;
    else if (node.type === "input") haystack = node.placeholder;
    else if (node.type === "image") haystack = node.alt;
    else if (node.type === "frame") haystack = node.title;
    if (!haystack || !haystack.toLowerCase().includes(needle)) return false;
  }
  if (predicate.hasStyleKey) {
    const style = (node as { style?: Record<string, unknown> }).style;
    if (!style || !(predicate.hasStyleKey in style)) return false;
  }
  return true;
}

export function findNodesInTree(
  root: DesignNode,
  predicate: FindNodePredicate,
  limit: number,
): { matches: NodeMatch[]; totalMatched: number; truncated: boolean } {
  const matches: NodeMatch[] = [];
  let total = 0;

  function walk(node: DesignNode, depth: number) {
    if (nodeMatches(node, predicate)) {
      total += 1;
      if (matches.length < limit) {
        matches.push({
          id: node.id ?? "",
          type: node.type,
          depth,
          summary: summarise(node),
        });
      }
    }
    if (hasChildren(node) && node.children) {
      for (const child of node.children) walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return { matches, totalMatched: total, truncated: total > matches.length };
}

/* ─── sibling-aware mutations ──────────────────────────── */

/**
 * Insert a deep clone of the target node as its next sibling. Returns the
 * new tree and the new node's id, or null if the target is the root or
 * not found (the root cannot be duplicated this way — the caller should
 * `add_artboard` instead).
 */
export function duplicateNodeInTree(
  root: DesignNode,
  targetId: string,
): { tree: DesignNode; newNodeId: string } | null {
  if (root.id === targetId) return null;

  function walk(
    node: DesignNode,
  ): { next: DesignNode; newNodeId: string | null } {
    if (!hasChildren(node) || !node.children) {
      return { next: node, newNodeId: null };
    }
    const idx = node.children.findIndex((c) => c.id === targetId);
    if (idx >= 0) {
      const original = node.children[idx];
      const clone = regenerateIds(original);
      const nextChildren = [
        ...node.children.slice(0, idx + 1),
        clone,
        ...node.children.slice(idx + 1),
      ];
      return {
        next: { ...node, children: nextChildren } as DesignNode,
        newNodeId: clone.id ?? null,
      };
    }
    const updatedChildren = node.children.slice();
    let foundId: string | null = null;
    for (let i = 0; i < updatedChildren.length; i++) {
      const result = walk(updatedChildren[i]);
      if (result.newNodeId) {
        updatedChildren[i] = result.next;
        foundId = result.newNodeId;
        break;
      }
    }
    if (!foundId) return { next: node, newNodeId: null };
    return {
      next: { ...node, children: updatedChildren } as DesignNode,
      newNodeId: foundId,
    };
  }

  const result = walk(root);
  if (!result.newNodeId) return null;
  return { tree: result.next, newNodeId: result.newNodeId };
}

/**
 * Replace the node at `targetId` with a `component-ref` to `componentSlug`.
 * Returns the new tree, or null if the target was the root (refusing to
 * replace an artboard's root with a single component-ref) or not found.
 */
export function replaceNodeWithComponentRef(
  root: DesignNode,
  targetId: string,
  componentSlug: string,
): DesignNode | null {
  if (root.id === targetId) return null;

  function walk(node: DesignNode): DesignNode | null {
    if (!hasChildren(node) || !node.children) return null;
    const idx = node.children.findIndex((c) => c.id === targetId);
    if (idx >= 0) {
      const original = node.children[idx];
      const ref: DesignNode = {
        type: "component-ref",
        componentSlug,
        id: original.id,
        ...(original.style ? { style: original.style } : {}),
      } as DesignNode;
      const nextChildren = node.children.slice();
      nextChildren[idx] = ref;
      return { ...node, children: nextChildren } as DesignNode;
    }
    for (let i = 0; i < node.children.length; i++) {
      const next = walk(node.children[i]);
      if (next) {
        const nextChildren = node.children.slice();
        nextChildren[i] = next;
        return { ...node, children: nextChildren } as DesignNode;
      }
    }
    return null;
  }

  return walk(root);
}

/**
 * Find a node and return a deep clone with fresh ids. Used by
 * `extract_component` to produce the saved component's tree without
 * sharing ids with the in-artboard subtree.
 */
export function cloneSubtreeWithFreshIds(
  root: DesignNode,
  targetId: string,
): DesignNode | null {
  function walk(node: DesignNode): DesignNode | null {
    if (node.id === targetId) return regenerateIds(node);
    if (hasChildren(node) && node.children) {
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(root);
}

/* ─── theme application ────────────────────────────────── */

export interface Theme {
  accent?: string;
  accentForeground?: string;
  radius?: number;
  fontFamily?: string;
}

/**
 * Walk the tree and apply a theme. Returns `{ tree, patchedNodeIds }`.
 * Heuristic but consistent:
 *   - `button` variant=primary  → backgroundColor=accent, color=accentForeground
 *   - `button` variant=secondary/outline → borderColor & color = accent
 *   - `button` variant=ghost     → color=accent
 *   - `link`                     → color=accent
 *   - `icon` (no explicit color) → color=accent (via style)
 *   - `button` / `card` / `input` → borderRadius=radius
 *   - root                       → fontFamily=fontFamily
 */
export function applyThemeToTree(
  root: DesignNode,
  theme: Theme,
): { tree: DesignNode; patchedNodeIds: string[] } {
  const patched: string[] = [];
  const fg = theme.accentForeground ?? "#ffffff";

  function patch(node: DesignNode): DesignNode {
    let changed = false;
    const styleSrc: Record<string, string | number> =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((node as any).style as Record<string, string | number>) ?? {};
    const nextStyle: Record<string, string | number> = { ...styleSrc };

    if (node.type === "button") {
      if (theme.accent) {
        const variant = node.variant ?? "primary";
        if (variant === "primary") {
          nextStyle.backgroundColor = theme.accent;
          nextStyle.color = fg;
          changed = true;
        } else if (variant === "secondary" || variant === "outline") {
          nextStyle.borderColor = theme.accent;
          nextStyle.color = theme.accent;
          changed = true;
        } else if (variant === "ghost") {
          nextStyle.color = theme.accent;
          changed = true;
        }
      }
      if (theme.radius !== undefined) {
        nextStyle.borderRadius = theme.radius;
        changed = true;
      }
    } else if (node.type === "link" && theme.accent) {
      nextStyle.color = theme.accent;
      changed = true;
    } else if (node.type === "icon" && theme.accent && !node.color) {
      nextStyle.color = theme.accent;
      changed = true;
    } else if (
      (node.type === "card" || node.type === "input") &&
      theme.radius !== undefined
    ) {
      nextStyle.borderRadius = theme.radius;
      changed = true;
    }

    const nextNode: DesignNode = changed
      ? ({ ...node, style: nextStyle } as DesignNode)
      : node;

    if (changed && node.id) patched.push(node.id);

    if (hasChildren(nextNode) && nextNode.children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (nextNode as any).children = nextNode.children.map((child) =>
        patch(child),
      );
    }
    return nextNode;
  }

  let next = patch(root);

  if (theme.fontFamily) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootStyle = ((next as any).style as Record<string, string | number>) ?? {};
    next = {
      ...next,
      style: { ...rootStyle, fontFamily: theme.fontFamily },
    } as DesignNode;
    if (next.id && !patched.includes(next.id)) patched.push(next.id);
  }

  return { tree: next, patchedNodeIds: patched };
}
