"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { DesignNode } from "./design-node";

export interface LibraryComponent {
  id: string;
  name: string;
  slug: string;
  tree: DesignNode;
}

interface ComponentLibraryContextValue {
  /** Index by slug for O(1) lookup during render. */
  bySlug: Map<string, LibraryComponent>;
  list: LibraryComponent[];
}

const ComponentLibraryContext = createContext<ComponentLibraryContextValue>({
  bySlug: new Map(),
  list: [],
});

/**
 * Provides the user's component library to the DesignRenderer (so
 * `component-ref` nodes can expand) and to the inspector / library tab
 * (so the UI can list / pick / remove).
 */
export function ComponentLibraryProvider({
  components,
  children,
}: {
  components: LibraryComponent[];
  children: ReactNode;
}) {
  const value = useMemo<ComponentLibraryContextValue>(
    () => ({
      bySlug: new Map(components.map((c) => [c.slug, c])),
      list: components,
    }),
    [components],
  );
  return (
    <ComponentLibraryContext.Provider value={value}>
      {children}
    </ComponentLibraryContext.Provider>
  );
}

export function useComponentLibrary() {
  return useContext(ComponentLibraryContext);
}
