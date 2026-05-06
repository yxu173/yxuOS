"use client";

import * as LucideIcons from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { createElement, type CSSProperties, type JSX } from "react";

import type {
  ButtonNode,
  CardNode,
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

interface RenderContext {
  selectedNodeId: string | null;
  onNodeClick: ((nodeId: string) => void) | null;
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
  const isSelected = !!node.id && ctx.selectedNodeId === node.id;
  const outlineStyle: CSSProperties = isSelected
    ? {
        boxShadow:
          "0 0 0 2px #3b82f6, 0 0 0 4px rgba(59, 130, 246, 0.25)",
      }
    : {};
  return {
    "data-node-id": node.id,
    onPointerDown:
      ctx.onNodeClick && node.id
        ? (event) => {
            event.stopPropagation();
            event.preventDefault();
            ctx.onNodeClick!(node.id!);
          }
        : undefined,
    style: { ...defaults, ...node.style, ...outlineStyle },
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
  // Read the renderer context exactly once per NodeRenderer instance so
  // the type-switch below isn't full of conditional hook calls.
  const ctx = useDesignRendererContext();

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
    switch (node.tag) {
      case "h1":
        return { fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 };
      case "h2":
        return { fontSize: 32, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.3 };
      case "h3":
        return { fontSize: 24, fontWeight: 600, lineHeight: 1.2 };
      case "h4":
        return { fontSize: 20, fontWeight: 600, lineHeight: 1.25 };
      case "h5":
        return { fontSize: 18, fontWeight: 600, lineHeight: 1.3 };
      case "h6":
        return { fontSize: 16, fontWeight: 600, lineHeight: 1.4 };
      case "p":
        return { fontSize: 16, lineHeight: 1.55, color: "#27272a" };
      case "label":
        return { fontSize: 14, fontWeight: 500, color: "#3f3f46" };
      default:
        return { fontSize: 14 };
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
        {...interactiveProps(node, ctx, defaults)}
      />
    );
  }
  // Placeholder.
  const lookupName = node.placeholderIcon ?? "image";
  const placeholderIconEl = renderLucideIcon(lookupName, { size: 32 });
  const placeholderDefaults: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: node.placeholderColor ?? "#e4e4e7",
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
  return renderLucideIcon(node.name, {
    size: node.size ?? 18,
    color: node.color,
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
