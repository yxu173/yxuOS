"use client";

import { createContext, useContext } from "react";

interface DesignRendererContextValue {
  /** Currently-selected node id within the active artboard. */
  selectedNodeId: string | null;
  /**
   * Click handler — fires when a node is clicked. Receives the node's id.
   * `null` disables interactivity (used for the read-only share view).
   */
  onNodeClick: ((nodeId: string) => void) | null;
}

const DesignRendererContext = createContext<DesignRendererContextValue>({
  selectedNodeId: null,
  onNodeClick: null,
});

export function DesignRendererProvider({
  selectedNodeId,
  onNodeClick,
  children,
}: DesignRendererContextValue & { children: React.ReactNode }) {
  return (
    <DesignRendererContext.Provider value={{ selectedNodeId, onNodeClick }}>
      {children}
    </DesignRendererContext.Provider>
  );
}

export function useDesignRendererContext() {
  return useContext(DesignRendererContext);
}
