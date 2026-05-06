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

/**
 * Renders a `DesignNode` tree to real React/DOM.
 *
 * Every node merges its `style` over a node-type default. The default
 * gives a sensible look out of the box (button colors, card border, link
 * underline, etc.); the agent overrides via `style` when it wants
 * something specific.
 *
 * Containers (`div`, `card`, `nav`, `section`, `frame`) recurse over
 * `children`. Leaves (`text`, `button`, `image`, `input`, `icon`, `link`,
 * `divider`) render directly.
 */
export function DesignRenderer({ node }: { node: DesignNode | null }) {
  if (!node) return null;
  return <NodeRenderer node={node} />;
}

function NodeRenderer({ node }: { node: DesignNode }): JSX.Element {
  switch (node.type) {
    case "div":
      return (
        <div style={mergeStyle({}, node.style)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </div>
      );
    case "section":
      return (
        <section style={mergeStyle({}, node.style)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </section>
      );
    case "nav":
      return (
        <nav style={mergeStyle({}, node.style)}>
          {(node.children ?? []).map((child, index) => (
            <NodeRenderer key={index} node={child} />
          ))}
        </nav>
      );
    case "card":
      return <CardRenderer node={node} />;
    case "frame":
      return <FrameRenderer node={node} />;
    case "text":
      return <TextRenderer node={node} />;
    case "button":
      return <ButtonRenderer node={node} />;
    case "image":
      return <ImageRenderer node={node} />;
    case "input":
      return <InputRenderer node={node} />;
    case "icon":
      return <IconRenderer node={node} />;
    case "link":
      return <LinkRenderer node={node} />;
    case "divider":
      return <DividerRenderer node={node} />;
    default: {
      // Exhaustiveness check.
      const _never: never = node;
      void _never;
      return <></>;
    }
  }
}

/* ─── Renderers ─────────────────────────────────────── */

function mergeStyle(
  defaults: CSSProperties,
  override: CSSProperties | undefined,
): CSSProperties {
  return override ? { ...defaults, ...override } : defaults;
}

function TextRenderer({ node }: { node: TextNode }) {
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
  return <Tag style={mergeStyle(defaults, node.style)}>{node.text}</Tag>;
}

function ButtonRenderer({ node }: { node: ButtonNode }) {
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
    <button type="button" style={mergeStyle(defaults, node.style)}>
      {node.label}
    </button>
  );
}

function ImageRenderer({ node }: { node: ImageNode }) {
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
        style={mergeStyle(defaults, node.style)}
      />
    );
  }
  // Placeholder.
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
  // resolveLucideIcon returns a stable component reference per name —
  // React.createElement keeps the lint rule happy (it can't tell a lookup
  // from inline-component-creation).
  const lookupName = node.placeholderIcon ?? "image";
  const placeholderIconEl = renderLucideIcon(lookupName, { size: 32 });
  return (
    <div style={mergeStyle(placeholderDefaults, node.style)}>
      {placeholderIconEl}
    </div>
  );
}

function InputRenderer({ node }: { node: InputNode }) {
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

  const input = (
    <input
      type={node.inputType ?? "text"}
      placeholder={node.placeholder}
      style={mergeStyle(defaults, node.style)}
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

function IconRenderer({ node }: { node: IconNode }) {
  return renderLucideIcon(node.name, {
    size: node.size ?? 18,
    color: node.color,
    style: node.style as CSSProperties,
  });
}

function LinkRenderer({ node }: { node: LinkNode }) {
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
      style={mergeStyle(defaults, node.style)}
    >
      {node.label}
    </a>
  );
}

function DividerRenderer({ node }: { node: DividerNode }) {
  const isVertical = node.orientation === "vertical";
  const defaults: CSSProperties = isVertical
    ? { width: 1, alignSelf: "stretch", background: "#e4e4e7" }
    : { height: 1, width: "100%", background: "#e4e4e7" };
  return <div style={mergeStyle(defaults, node.style)} />;
}

function CardRenderer({ node }: { node: CardNode }) {
  const defaults: CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 2px rgb(0 0 0 / 0.04)",
  };
  return (
    <div style={mergeStyle(defaults, node.style)}>
      {(node.children ?? []).map((child, index) => (
        <NodeRenderer key={index} node={child} />
      ))}
    </div>
  );
}

function FrameRenderer({ node }: { node: FrameNode }) {
  const defaults: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
  return (
    <div style={mergeStyle(defaults, node.style)}>
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
 * We use `createElement` rather than `<Icon />` so the lint rule that
 * forbids creating components inline (`react-hooks/static-components`)
 * stays happy — the lookup returns a stable component reference per
 * name, but the linter can't tell that from inline definition.
 */
function renderLucideIcon(
  name: string,
  props: { size?: number; color?: string; style?: CSSProperties },
): JSX.Element | null {
  const pascal = name
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
  const Component = ICON_REGISTRY[pascal];
  if (!Component) return null;
  return createElement(Component, props);
}
