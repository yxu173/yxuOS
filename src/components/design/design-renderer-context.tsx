"use client";

import { createContext, useContext, useMemo } from "react";

interface DesignRendererContextValue {
  /**
   * Every picked node id in pick order. The renderer draws the blue
   * selection ring on every node whose id is in this list, so multi-
   * pick lights up multiple elements at once. Empty array = nothing
   * picked.
   */
  selectedNodeIds: readonly string[];
  /**
   * Click handler — fires when a node is clicked. Receives the
   * node's id and a flag indicating whether the click was additive
   * (shift was held). `null` disables interactivity (used for the
   * read-only share view).
   */
  onNodeClick: ((nodeId: string, additive: boolean) => void) | null;
}

const DesignRendererContext = createContext<DesignRendererContextValue>({
  selectedNodeIds: [],
  onNodeClick: null,
});

export function DesignRendererProvider({
  selectedNodeIds,
  onNodeClick,
  children,
}: DesignRendererContextValue & { children: React.ReactNode }) {
  // Memoise so the context value identity stays stable when the
  // selection didn't actually change — saves cascade re-renders
  // through every NodeRenderer when a sibling's style changes.
  const value = useMemo<DesignRendererContextValue>(
    () => ({ selectedNodeIds, onNodeClick }),
    [selectedNodeIds, onNodeClick],
  );
  return (
    <DesignRendererContext.Provider value={value}>
      {children}
    </DesignRendererContext.Provider>
  );
}

export function useDesignRendererContext() {
  return useContext(DesignRendererContext);
}
