"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { mergeTokens, type TokenSet } from "./tokens";

/**
 * Provides the active design's token set (team defaults + per-design
 * overrides + an optimistic overlay) to the renderer and any UI that
 * wants to read "what is `{color.accent}` right now?".
 *
 * Mirrors `ComponentLibraryProvider`'s shape: server data is the
 * source of truth, optimistic state stacks on top so set_tokens /
 * apply_theme can propagate to the canvas before
 * `router.refresh()` round-trips.
 *
 * Optimistic patches are split across the same two scopes — team /
 * design — so future cross-design propagation (when team tokens
 * change in one design's tab) can still distinguish them.
 */
interface TokenContextValue extends TokenSet {
  /** Pre-merged map. Renderer reads from here; callers that need the
   *  scoped split read `team` / `design` separately. */
  merged: Record<string, string | number>;
  /** Patch the design-scope optimistic overlay. `null` value clears
   *  a key. */
  registerOptimisticDesignTokens: (
    patch: Record<string, string | number | null>,
  ) => void;
  /** Patch the team-scope optimistic overlay. */
  registerOptimisticTeamTokens: (
    patch: Record<string, string | number | null>,
  ) => void;
}

const TokenContext = createContext<TokenContextValue>({
  team: {},
  design: {},
  merged: {},
  registerOptimisticDesignTokens: () => {},
  registerOptimisticTeamTokens: () => {},
});

export function TokenProvider({
  team,
  design,
  children,
}: {
  /** Team-default tokens from the server. */
  team: Record<string, string | number>;
  /** Per-design tokens from the server. */
  design: Record<string, string | number>;
  children: ReactNode;
}) {
  const [optimisticTeam, setOptimisticTeam] = useState<
    Record<string, string | number>
  >({});
  const [optimisticDesign, setOptimisticDesign] = useState<
    Record<string, string | number>
  >({});

  const registerOptimisticTeamTokens = useCallback(
    (patch: Record<string, string | number | null>) => {
      setOptimisticTeam((prev) => applyTokenPatch(prev, patch));
    },
    [],
  );

  const registerOptimisticDesignTokens = useCallback(
    (patch: Record<string, string | number | null>) => {
      setOptimisticDesign((prev) => applyTokenPatch(prev, patch));
    },
    [],
  );

  const value = useMemo<TokenContextValue>(() => {
    // Optimistic overlays sit on top of server data within their own
    // scope; the merge order then mirrors the renderer's resolution
    // order (design wins over team).
    const mergedTeam = { ...team, ...optimisticTeam };
    const mergedDesign = { ...design, ...optimisticDesign };
    return {
      team: mergedTeam,
      design: mergedDesign,
      merged: mergeTokens({ team: mergedTeam, design: mergedDesign }),
      registerOptimisticTeamTokens,
      registerOptimisticDesignTokens,
    };
  }, [
    team,
    design,
    optimisticTeam,
    optimisticDesign,
    registerOptimisticTeamTokens,
    registerOptimisticDesignTokens,
  ]);

  return (
    <TokenContext.Provider value={value}>{children}</TokenContext.Provider>
  );
}

export function useTokens() {
  return useContext(TokenContext);
}

/* ─── helpers ──────────────────────────────────────────── */

/**
 * Apply a patch to a token map. `null` values delete a key; explicit
 * `string|number` values set/replace; missing keys are unchanged.
 */
function applyTokenPatch(
  prev: Record<string, string | number>,
  patch: Record<string, string | number | null>,
): Record<string, string | number> {
  const next: Record<string, string | number> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}
