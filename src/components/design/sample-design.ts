import type { DesignNode } from "./design-node";

/**
 * A canned landing-page DesignNode tree. Used by the "Insert sample" dev
 * button to verify the renderer end-to-end before the agent is wired.
 *
 * Mirrors the kind of output we expect from the design agent: nested
 * sections, nav, hero, features, footer, with inline CSS for everything.
 */
export const SAMPLE_LANDING: DesignNode = {
  type: "div",
  style: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: "100%",
    background: "#fafafa",
    color: "#18181b",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  children: [
    /* ── Nav ── */
    {
      type: "nav",
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 64px",
        borderBottom: "1px solid #e4e4e7",
        background: "#ffffff",
      },
      children: [
        {
          type: "div",
          style: { display: "flex", alignItems: "center", gap: 8 },
          children: [
            {
              type: "icon",
              name: "zap",
              size: 20,
              color: "#6366f1",
            },
            {
              type: "text",
              text: "Stride",
              tag: "span",
              style: { fontSize: 18, fontWeight: 700, letterSpacing: -0.2 },
            },
          ],
        },
        {
          type: "div",
          style: { display: "flex", alignItems: "center", gap: 32 },
          children: [
            {
              type: "link",
              label: "Features",
              style: { color: "#52525b", textDecoration: "none" },
            },
            {
              type: "link",
              label: "Pricing",
              style: { color: "#52525b", textDecoration: "none" },
            },
            {
              type: "link",
              label: "Docs",
              style: { color: "#52525b", textDecoration: "none" },
            },
            {
              type: "button",
              label: "Sign in",
              variant: "ghost",
              size: "sm",
            },
            {
              type: "button",
              label: "Get started",
              variant: "primary",
              size: "sm",
            },
          ],
        },
      ],
    },

    /* ── Hero ── */
    {
      type: "section",
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        padding: "120px 64px 80px",
        textAlign: "center",
      },
      children: [
        {
          type: "div",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            background: "#eef2ff",
            color: "#4338ca",
            border: "1px solid #c7d2fe",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
          },
          children: [
            { type: "icon", name: "sparkles", size: 14 },
            { type: "text", text: "New · AI-powered analytics", tag: "span" },
          ],
        },
        {
          type: "text",
          text: "Ship faster. Decide smarter.",
          tag: "h1",
          style: { maxWidth: 720, fontSize: 64, lineHeight: 1.05 },
        },
        {
          type: "text",
          text: "Stride turns raw product data into the next experiment your team should run — automatically.",
          tag: "p",
          style: { maxWidth: 600, fontSize: 18, color: "#52525b" },
        },
        {
          type: "div",
          style: { display: "flex", gap: 12, marginTop: 8 },
          children: [
            { type: "button", label: "Start free trial", variant: "primary", size: "lg" },
            { type: "button", label: "See it in 90s", variant: "outline", size: "lg" },
          ],
        },
        {
          type: "image",
          placeholderColor: "#e4e4e7",
          placeholderIcon: "image",
          style: {
            width: "100%",
            maxWidth: 1040,
            height: 480,
            marginTop: 48,
            borderRadius: 16,
            border: "1px solid #e4e4e7",
            boxShadow: "0 30px 60px -15px rgb(0 0 0 / 0.15)",
          },
        },
      ],
    },

    /* ── Features ── */
    {
      type: "section",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 48,
        padding: "80px 64px",
        background: "#ffffff",
        borderTop: "1px solid #e4e4e7",
      },
      children: [
        {
          type: "div",
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            textAlign: "center",
          },
          children: [
            {
              type: "text",
              text: "Built for fast-moving product teams",
              tag: "h2",
              style: { fontSize: 40 },
            },
            {
              type: "text",
              text: "Three things every PM and engineer asks for.",
              tag: "p",
              style: { fontSize: 16, color: "#71717a" },
            },
          ],
        },
        {
          type: "div",
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 20,
          },
          children: [
            featureCard("activity", "Real-time funnels", "Watch your funnel live as your release rolls out. Anomalies surface in seconds, not hours."),
            featureCard("git-branch", "Branch-aware analytics", "Every PR gets a preview environment with isolated metrics. Compare A/B without infra plumbing."),
            featureCard("brain", "AI experiment recommender", "Stride's agent reads your event history and suggests the next experiment to run, ranked by expected lift."),
          ],
        },
      ],
    },

    /* ── CTA ── */
    {
      type: "section",
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 48,
        padding: "64px",
        margin: "0 64px",
        marginTop: 80,
        marginBottom: 80,
        background: "#18181b",
        color: "#fafafa",
        borderRadius: 24,
      },
      children: [
        {
          type: "div",
          style: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 },
          children: [
            { type: "text", text: "Try Stride for 14 days.", tag: "h3", style: { fontSize: 32 } },
            { type: "text", text: "No credit card. Set up in under five minutes — your team will see funnels by lunch.", tag: "p", style: { color: "#a1a1aa", fontSize: 16 } },
          ],
        },
        {
          type: "div",
          style: { display: "flex", gap: 12 },
          children: [
            { type: "button", label: "Start free trial", variant: "primary", size: "lg", style: { background: "#fafafa", color: "#18181b" } },
            { type: "button", label: "Talk to sales", variant: "outline", size: "lg", style: { borderColor: "#3f3f46", color: "#fafafa" } },
          ],
        },
      ],
    },

    /* ── Footer ── */
    {
      type: "section",
      style: {
        padding: "32px 64px",
        borderTop: "1px solid #e4e4e7",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#ffffff",
      },
      children: [
        { type: "text", text: "© 2026 Stride, Inc.", tag: "span", style: { fontSize: 13, color: "#71717a" } },
        {
          type: "div",
          style: { display: "flex", gap: 24 },
          children: [
            { type: "link", label: "Privacy", style: { color: "#71717a", textDecoration: "none", fontSize: 13 } },
            { type: "link", label: "Terms", style: { color: "#71717a", textDecoration: "none", fontSize: 13 } },
            { type: "link", label: "Status", style: { color: "#71717a", textDecoration: "none", fontSize: 13 } },
          ],
        },
      ],
    },
  ],
};

function featureCard(icon: string, title: string, body: string): DesignNode {
  return {
    type: "card",
    style: { display: "flex", flexDirection: "column", gap: 14, padding: 28 },
    children: [
      {
        type: "div",
        style: {
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#eef2ff",
          color: "#4338ca",
          borderRadius: 10,
        },
        children: [{ type: "icon", name: icon, size: 18 }],
      },
      { type: "text", text: title, tag: "h4", style: { fontSize: 18 } },
      { type: "text", text: body, tag: "p", style: { fontSize: 14, color: "#52525b", lineHeight: 1.6 } },
    ],
  };
}
