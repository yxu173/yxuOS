"use client";

import * as LucideIcons from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { createElement, type CSSProperties, type JSX } from "react";

import {
  useComponentLibrary,
  type LibraryComponent,
} from "./component-library-context";
import type {
  ButtonNode,
  CardNode,
  ComponentRefNode,
  DesignNode,
  DividerNode,
  IconNode,
  ImageNode,
  InputNode,
  LinkNode,
  TextNode,
  FrameNode,
} from "./design-node";
import { useDesignRendererContext } from "./design-renderer-context";
import { useTokens } from "./token-context";
import { resolveStyle, resolveStyleValue } from "./tokens";

interface RenderContext {
  /** Every picked node id; the renderer paints a selection ring on
   *  every match. */
  selectedNodeIds: readonly string[];
  /** Click handler — receives the node id and whether shift was held
   *  (additive multi-pick). `null` disables interactivity. */
  onNodeClick: ((nodeId: string, additive: boolean) => void) | null;
  library: Map<string, LibraryComponent>;
  /** Pre-merged token map. Style values that look like
   *  `"{token.path}"` are resolved against this. */
  tokens: Record<string, string | number>;
}

interface InteractiveProps {
  "data-node-id": string | undefined;
  onPointerDown?: (event: React.PointerEvent) => void;
  style: CSSProperties;
}

/**
 * Compute `data-node-id`, `onPointerDown`, and `style` (with selection
 * outline) for a node given the rendering context. Pure function — the
 * context is read at the top of `<NodeRenderer>` (a hook call) and passed
 * down to leaves so each branch of the type-switch isn't a separate
 * conditional hook call.
 */
function interactiveProps(
  node: DesignNode,
  ctx: RenderContext,
  defaults: CSSProperties = {},
): InteractiveProps {
  const isSelected =
    !!node.id && ctx.selectedNodeIds.includes(node.id);
  const outlineStyle: CSSProperties = isSelected
    ? {
        boxShadow:
          "0 0 0 2px #3b82f6, 0 0 0 4px rgba(59, 130, 246, 0.25)",
      }
    : {};
  // Resolve `{token.path}` references on the node-level style ONLY —
  // defaults and the selection outline are already concrete literals,
  // and resolving them every call would be a small waste. The merge
  // order matches React's rightmost-wins semantics: defaults < node
  // style (resolved) < selection outline.
  const resolvedStyle = resolveStyle(
    node.style as Record<string, unknown> | undefined,
    ctx.tokens,
  );
  return {
    "data-node-id": node.id,
    onPointerDown:
      ctx.onNodeClick && node.id
        ? (event) => {
            event.stopPropagation();
            event.preventDefault();
            // Shift-click = additive multi-pick. Without shift the
            // pick replaces the set with just this node.
            ctx.onNodeClick!(node.id!, event.shiftKey);
          }
        : undefined,
    style: {
      ...defaults,
      ...(resolvedStyle as CSSProperties | undefined),
      ...outlineStyle,
    },
  };
}

/**
 * Renders a `DesignNode` tree to real React/DOM.
 */
export function DesignRenderer({ node }: { node: DesignNode | null }) {
  if (!node) return null;
  return <NodeRenderer node={node} />;
}

function NodeRenderer({ node }: { node: DesignNode }): JSX.Element {
  // Read every context we need exactly once per NodeRenderer instance
  // so the type-switch below isn't full of conditional hook calls.
  const rendererCtx = useDesignRendererContext();
  const library = useComponentLibrary();
  const tokens = useTokens();
  const ctx: RenderContext = {
    ...rendererCtx,
    library: library.bySlug,
    tokens: tokens.merged,
  };

  // Hidden nodes are skipped entirely — they stay in the tree (so the
  // agent can toggle them back on, the layers panel can show them, and
  // every id remains stable) but never paint.
  if (node.hidden) return <></>;

  switch (node.type) {
    case "div":
      return (
        <div {...interactiveProps(node, ctx)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </div>
      );
    case "section":
      return (
        <section {...interactiveProps(node, ctx)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </section>
      );
    case "nav":
      return (
        <nav {...interactiveProps(node, ctx)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </nav>
      );
    case "card":
      return <CardRenderer node={node} ctx={ctx} />;
    case "frame":
      return <FrameRenderer node={node} ctx={ctx} />;
    case "text":
      return <TextRenderer node={node} ctx={ctx} />;
    case "button":
      return <ButtonRenderer node={node} ctx={ctx} />;
    case "image":
      return <ImageRenderer node={node} ctx={ctx} />;
    case "input":
      return <InputRenderer node={node} ctx={ctx} />;
    case "icon":
      return <IconRenderer node={node} ctx={ctx} />;
    case "link":
      return <LinkRenderer node={node} ctx={ctx} />;
    case "divider":
      return <DividerRenderer node={node} ctx={ctx} />;
    case "component-ref":
      return <ComponentRefRenderer node={node} ctx={ctx} />;
    default: {
      // Exhaustiveness check.
      const _never: never = node;
      void _never;
      return <></>;
    }
  }
}

/* ─── Renderers ─────────────────────────────────────── */

function TextRenderer({ node, ctx }: { node: TextNode; ctx: RenderContext }) {
  const Tag = (node.tag ?? "span") as keyof JSX.IntrinsicElements;
  const defaults: CSSProperties = (() => {
    const base: CSSProperties = { cursor: "text" };
    switch (node.tag) {
      case "h1":
        return { ...base, fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 };
      case "h2":
        return { ...base, fontSize: 32, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.3 };
      case "h3":
        return { ...base, fontSize: 24, fontWeight: 600, lineHeight: 1.2 };
      case "h4":
        return { ...base, fontSize: 20, fontWeight: 600, lineHeight: 1.25 };
      case "h5":
        return { ...base, fontSize: 18, fontWeight: 600, lineHeight: 1.3 };
      case "h6":
        return { ...base, fontSize: 16, fontWeight: 600, lineHeight: 1.4 };
      case "p":
        return { ...base, fontSize: 16, lineHeight: 1.55, color: "#27272a" };
      case "label":
        return { ...base, fontSize: 14, fontWeight: 500, color: "#3f3f46" };
      default:
        return { ...base, fontSize: 14 };
    }
  })();
  return <Tag {...interactiveProps(node, ctx, defaults)}>{node.text}</Tag>;
}

function ButtonRenderer({
  node,
  ctx,
}: {
  node: ButtonNode;
  ctx: RenderContext;
}) {
  const variant = node.variant ?? "primary";
  const size = node.size ?? "md";

  const sizeStyle: CSSProperties =
    size === "sm"
      ? { padding: "6px 12px", fontSize: 13, height: 32 }
      : size === "lg"
        ? { padding: "12px 24px", fontSize: 16, height: 48 }
        : { padding: "10px 18px", fontSize: 14, height: 40 };

  const variantStyle: CSSProperties = (() => {
    switch (variant) {
      case "secondary":
        return {
          background: "#f4f4f5",
          color: "#18181b",
          border: "1px solid #e4e4e7",
        };
      case "ghost":
        return { background: "transparent", color: "#18181b" };
      case "outline":
        return {
          background: "transparent",
          color: "#18181b",
          border: "1px solid #d4d4d8",
        };
      case "primary":
      default:
        return { background: "#18181b", color: "#fafafa" };
    }
  })();

  const defaults: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 8,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    ...sizeStyle,
    ...variantStyle,
  };

  return (
    <button type="button" {...interactiveProps(node, ctx, defaults)}>
      {node.label}
    </button>
  );
}

function ImageRenderer({
  node,
  ctx,
}: {
  node: ImageNode;
  ctx: RenderContext;
}) {
  const defaults: CSSProperties = {
    display: "block",
    objectFit: "cover",
    borderRadius: 8,
  };

  if (node.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={node.src}
        alt={node.alt ?? ""}
        {...interactiveProps(node, ctx, { ...defaults, cursor: "pointer" })}
      />
    );
  }
  // Placeholder.
  const lookupName = node.placeholderIcon ?? "image";
  const placeholderIconEl = renderLucideIcon(lookupName, { size: 32 });
  // placeholderColor is a leaf prop, not part of `style`, so resolve
  // here too — the agent may use a token ref like `{color.muted}`.
  const placeholderColorRaw = node.placeholderColor ?? "#e4e4e7";
  const placeholderColor =
    typeof resolveStyleValue(placeholderColorRaw, ctx.tokens) === "string"
      ? (resolveStyleValue(placeholderColorRaw, ctx.tokens) as string)
      : placeholderColorRaw;
  const placeholderDefaults: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: placeholderColor,
    color: "#a1a1aa",
    borderRadius: 8,
    minWidth: 80,
    minHeight: 80,
  };
  return (
    <div {...interactiveProps(node, ctx, placeholderDefaults)}>
      {placeholderIconEl}
    </div>
  );
}

function InputRenderer({
  node,
  ctx,
}: {
  node: InputNode;
  ctx: RenderContext;
}) {
  const defaults: CSSProperties = {
    display: "block",
    width: "100%",
    padding: "10px 14px",
    fontSize: 14,
    background: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: 8,
    color: "#18181b",
    cursor: "text",
  };
  const props = interactiveProps(node, ctx, defaults);
  const input = (
    <input
      type={node.inputType ?? "text"}
      placeholder={node.placeholder}
      readOnly
      {...props}
    />
  );
  if (!node.label) return input;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: "#3f3f46" }}>
        {node.label}
      </span>
      {input}
    </label>
  );
}

function IconRenderer({ node, ctx }: { node: IconNode; ctx: RenderContext }) {
  const props = interactiveProps(node, ctx, {});
  // `color` is an icon-level prop (not in style) — resolve token
  // refs here too, otherwise `color: "{color.accent}"` would render
  // literally.
  const resolvedColor =
    typeof node.color === "string"
      ? (resolveStyleValue(node.color, ctx.tokens) as string)
      : node.color;
  return renderLucideIcon(node.name, {
    size: node.size ?? 18,
    color: resolvedColor,
    style: props.style,
    "data-node-id": props["data-node-id"],
    onPointerDown: props.onPointerDown,
  });
}

function LinkRenderer({ node, ctx }: { node: LinkNode; ctx: RenderContext }) {
  const defaults: CSSProperties = {
    color: "#3b82f6",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    fontSize: 14,
    cursor: "pointer",
  };
  return (
    <a
      href={node.href ?? "#"}
      onClick={(event) => event.preventDefault()}
      {...interactiveProps(node, ctx, defaults)}
    >
      {node.label}
    </a>
  );
}

function DividerRenderer({
  node,
  ctx,
}: {
  node: DividerNode;
  ctx: RenderContext;
}) {
  const isVertical = node.orientation === "vertical";
  const defaults: CSSProperties = isVertical
    ? { width: 1, alignSelf: "stretch", background: "#e4e4e7" }
    : { height: 1, width: "100%", background: "#e4e4e7" };
  return <div {...interactiveProps(node, ctx, defaults)} />;
}

function CardRenderer({ node, ctx }: { node: CardNode; ctx: RenderContext }) {
  const defaults: CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 2px rgb(0 0 0 / 0.04)",
  };
  return (
    <div {...interactiveProps(node, ctx, defaults)}>
      {(node.children ?? []).map((child, index) => (
        <NodeRenderer key={index} node={child} />
      ))}
    </div>
  );
}

function FrameRenderer({
  node,
  ctx,
}: {
  node: FrameNode;
  ctx: RenderContext;
}) {
  const defaults: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
  return (
    <div {...interactiveProps(node, ctx, defaults)}>
      {node.title ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#71717a",
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {node.title}
        </div>
      ) : null}
      {(node.children ?? []).map((child, index) => (
        <NodeRenderer key={index} node={child} />
      ))}
    </div>
  );
}

function ComponentRefRenderer({
  node,
  ctx,
}: {
  node: ComponentRefNode;
  ctx: RenderContext;
}) {
  const component = ctx.library.get(node.componentSlug);
  if (!component) {
    return (
      <div
        {...interactiveProps(node, ctx, {
          padding: "12px 16px",
          background: "rgba(244, 63, 94, 0.08)",
          color: "#dc2626",
          border: "1px dashed #fecaca",
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        })}
      >
        Missing component: {node.componentSlug}
      </div>
    );
  }
  // Wrap the expansion in a div with display: contents so the wrapper
  // doesn't disrupt the parent's layout, plus carries the ref's
  // selection / click handling. Style overrides on the ref apply via
  // interactiveProps' default merge.
  return (
    <div {...interactiveProps(node, ctx, { display: "contents" })}>
      <NodeRenderer node={component.tree} />
    </div>
  );
}

/* ─── Lucide name → element ─────────────────────────── */

const ICON_REGISTRY = LucideIcons as unknown as Record<string, LucideIcon>;

/**
 * Look up a lucide icon by kebab-case name and return a React element.
 *
 * Uses `createElement` rather than `<Icon />` so the lint rule that
 * forbids creating components inline (`react-hooks/static-components`)
 * stays happy — the lookup returns a stable component reference per
 * name, but the linter can't tell that from inline definition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderLucideIcon(name: string, props: any): JSX.Element | null {
  const pascal = name
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
  const Component = ICON_REGISTRY[pascal];
  if (!Component) return null;
  return createElement(Component, props);
}
