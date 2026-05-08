/**
 * The agent's design output schema.
 *
 * A `DesignNode` is a strictly-typed JSON tree that represents one screen.
 * The agent emits trees of these; `<DesignRenderer>` walks them and renders
 * real DOM. We keep the surface small (12 node types) and explicit so:
 *
 *  - The agent has a tight, predictable spec to follow.
 *  - We can validate / sanitize before rendering (no arbitrary HTML).
 *  - Future per-element editing has a stable target to mutate.
 */

import type { CSSProperties } from "react";

/**
 * Subset of CSS we accept. We exclude positioning props that would let the
 * agent escape its artboard (`position: fixed`, `position: absolute` is
 * fine, sticky/fixed not). We accept the rest of layout / typography /
 * color / box-shadow for design freedom.
 */
export type CSSProps = Omit<
  CSSProperties,
  // Strip positioning escape hatches.
  "position" | "zIndex"
>;

/* ─── Per-node interfaces ─────────────────────────────── */

interface BaseNode {
  /** Optional id — useful for the agent to reference specific nodes
   * (e.g. "update the heading with id 'hero-title'"). */
  id?: string;
  /** Inline styles. Take precedence over the node-type defaults. */
  style?: CSSProps;
}

export interface DivNode extends BaseNode {
  type: "div";
  children?: DesignNode[];
}

export interface TextNode extends BaseNode {
  type: "text";
  text: string;
  /** Semantic tag. Defaults to `span`. */
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "label";
}

export interface ButtonNode extends BaseNode {
  type: "button";
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  /**
   * Optional prototype link — clicking this button conceptually
   * "navigates" to the target artboard. Visualized as an arrow in
   * flow-view; ignored otherwise. Stored on the node so it travels
   * with `duplicate_node` / `extract_component` / `move_nodes`.
   */
  flowTo?: { artboardId: string };
}

export interface ImageNode extends BaseNode {
  type: "image";
  src?: string;
  alt?: string;
  /**
   * Placeholder rendered when no `src` is provided. The agent typically
   * leaves `src` empty and lets the placeholder represent imagery.
   */
  placeholderColor?: string;
  /** Lucide icon name (kebab-case) shown in the placeholder. */
  placeholderIcon?: string;
}

export interface InputNode extends BaseNode {
  type: "input";
  placeholder?: string;
  inputType?: "text" | "email" | "password" | "search" | "number" | "tel";
  /** Optional label rendered above the input. */
  label?: string;
}

export interface IconNode extends BaseNode {
  type: "icon";
  /** Lucide icon name in kebab-case (e.g. "arrow-right"). */
  name: string;
  size?: number;
  color?: string;
}

export interface LinkNode extends BaseNode {
  type: "link";
  label: string;
  href?: string;
  /**
   * Same shape as ButtonNode.flowTo — the link's "click target" in
   * the prototype graph. `href` and `flowTo` may coexist; the
   * renderer treats `href` as the rendered DOM attribute and
   * `flowTo` as the canvas-only prototype edge.
   */
  flowTo?: { artboardId: string };
}

export interface DividerNode extends BaseNode {
  type: "divider";
  orientation?: "horizontal" | "vertical";
}

export interface CardNode extends BaseNode {
  type: "card";
  children?: DesignNode[];
}

export interface NavNode extends BaseNode {
  type: "nav";
  children?: DesignNode[];
}

export interface SectionNode extends BaseNode {
  type: "section";
  children?: DesignNode[];
}

export interface FrameNode extends BaseNode {
  type: "frame";
  /** Optional title rendered above the frame's content. */
  title?: string;
  children?: DesignNode[];
}

/**
 * Reference to a reusable component from the user's design system.
 *
 * Renders by looking the slug up in the component library and expanding
 * the referenced tree at render time. `style` overlays on the expanded
 * root so a single component can be re-used with size / colour overrides
 * (e.g. a "Logo" component used at different sizes).
 */
export interface ComponentRefNode extends BaseNode {
  type: "component-ref";
  /** Slug of the component to expand (e.g. "stride-logo"). */
  componentSlug: string;
}

export type DesignNode =
  | DivNode
  | TextNode
  | ButtonNode
  | ImageNode
  | InputNode
  | IconNode
  | LinkNode
  | DividerNode
  | CardNode
  | NavNode
  | SectionNode
  | FrameNode
  | ComponentRefNode;
