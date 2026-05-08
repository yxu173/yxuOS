/**
 * Design-token resolution. Both the renderer and any code that needs
 * to compute "what color is the accent right now?" goes through here.
 *
 * Tokens are flat `Record<dotted-path, string|number>` blobs (e.g.
 * `{ "color.accent": "#10b981", "radius.md": 12 }`) at two scopes:
 *
 *   1. **Team defaults** — set once for a team's brand baseline.
 *   2. **Per-design overrides** — design-specific values that win.
 *
 * The agent emits token references as the magic string `"{token.path}"`
 * inside `style` values; the renderer's `resolveStyleValue` swaps the
 * reference for the resolved value at paint time. Plain literals
 * (hex colors, raw numbers) pass through untouched, so existing
 * trees keep working without migration.
 */

export interface TokenSet {
  /** Team-default tokens. */
  team: Record<string, string | number>;
  /** Per-design overrides. */
  design: Record<string, string | number>;
}

/**
 * Build a single resolution map by overlaying per-design tokens on
 * top of team defaults. Use this once per render pass (cheap — both
 * sides are small flat objects) and read with `resolveStyleValue`.
 */
export function mergeTokens(set: TokenSet): Record<string, string | number> {
  return { ...set.team, ...set.design };
}

const REF_PATTERN = /^\{([a-zA-Z0-9._-]+)\}$/;

/**
 * Resolve a single style value. If it's a reference like
 * `"{color.accent}"`, look the path up in `merged`. Returns the
 * resolved value when found; returns the original string unchanged
 * when the token is missing — easier to debug than a silent
 * fallthrough, and the "broken" rendered state hints to the user that
 * they need to set the token.
 *
 * Non-string values (numbers, booleans) and non-reference strings
 * pass through. The check is intentionally strict (full-string
 * `^{...}$`) so values like `"linear-gradient({color.from}, ...)"`
 * stay literal — partial substitution is a future feature; today's
 * agent is told to use single-token references only.
 */
export function resolveStyleValue(
  value: unknown,
  merged: Record<string, string | number>,
): unknown {
  if (typeof value !== "string") return value;
  const match = REF_PATTERN.exec(value);
  if (!match) return value;
  const path = match[1];
  if (path in merged) return merged[path];
  return value; // unresolved — leave as-is so it's visibly broken
}

/**
 * Resolve every value of a style object. Returns a new object so the
 * renderer can keep React's referential-equality assumptions. If
 * nothing was a reference, returns the original to skip the allocation.
 */
export function resolveStyle<T extends Record<string, unknown>>(
  style: T | undefined,
  merged: Record<string, string | number>,
): T | undefined {
  if (!style) return style;
  let touched = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    const resolved = resolveStyleValue(v, merged);
    if (resolved !== v) touched = true;
    next[k] = resolved;
  }
  return touched ? (next as T) : style;
}

/**
 * Common token paths the agent should reach for. Listed here so we can
 * point the prompt and the inspector at a shared vocabulary; the
 * underlying token blob remains free-form (any dotted key is allowed).
 */
export const COMMON_TOKEN_PATHS = [
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
] as const;
