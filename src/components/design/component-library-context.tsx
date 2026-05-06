"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { DesignNode } from "./design-node";

export interface LibraryComponent {
  id: string;
  name: string;
  slug: string;
  tree: DesignNode;
}

export interface LibraryAsset {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
}

interface ComponentLibraryContextValue {
  /** Index components by slug for O(1) lookup during render. */
  bySlug: Map<string, LibraryComponent>;
  components: LibraryComponent[];
  assets: LibraryAsset[];
}

const ComponentLibraryContext = createContext<ComponentLibraryContextValue>({
  bySlug: new Map(),
  components: [],
  assets: [],
});

/**
 * Provides the user's library (saved DesignNode components + uploaded
 * image assets) to the DesignRenderer, the chat panel, and the library
 * tab.
 */
export function ComponentLibraryProvider({
  components,
  assets,
  children,
}: {
  components: LibraryComponent[];
  assets: LibraryAsset[];
  children: ReactNode;
}) {
  const value = useMemo<ComponentLibraryContextValue>(
    () => ({
      bySlug: new Map(components.map((c) => [c.slug, c])),
      components,
      assets,
    }),
    [components, assets],
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
