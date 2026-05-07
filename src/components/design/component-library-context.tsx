"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
  /**
   * Optimistically register a component so the renderer / list_components
   * tool see it immediately, without waiting for `router.refresh()` to
   * round-trip the new server-provided list. Existing entries with the
   * same slug are replaced. The optimistic overlay is auto-pruned the
   * next render after the server-provided data picks up the same slug
   * (idempotent — calling this with a slug that's already on the server
   * is a no-op).
   */
  registerOptimisticComponent: (component: LibraryComponent) => void;
  /** Same as above for assets. Keyed on id (assets don't have slugs). */
  registerOptimisticAsset: (asset: LibraryAsset) => void;
}

const ComponentLibraryContext = createContext<ComponentLibraryContextValue>({
  bySlug: new Map(),
  components: [],
  assets: [],
  registerOptimisticComponent: () => {},
  registerOptimisticAsset: () => {},
});

/**
 * Provides the user's library (saved DesignNode components + uploaded
 * image assets) to the DesignRenderer, the chat panel, and the library
 * tab.
 *
 * Server-provided `components` / `assets` are the source of truth; an
 * optimistic overlay state lives on top so things saved this session
 * (via `extract_component` / `update_component` / asset upload) appear
 * instantly, before `router.refresh()` round-trips the new data. When
 * the server-provided list catches up (matching slug / id), the
 * overlay entry naturally falls out of the merge and the server entry
 * wins.
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
  const [optimisticComponents, setOptimisticComponents] = useState<
    Map<string, LibraryComponent>
  >(new Map());
  const [optimisticAssets, setOptimisticAssets] = useState<
    Map<string, LibraryAsset>
  >(new Map());

  const registerOptimisticComponent = useCallback(
    (component: LibraryComponent) => {
      setOptimisticComponents((prev) => {
        const next = new Map(prev);
        next.set(component.slug, component);
        return next;
      });
    },
    [],
  );

  const registerOptimisticAsset = useCallback((asset: LibraryAsset) => {
    setOptimisticAssets((prev) => {
      const next = new Map(prev);
      next.set(asset.id, asset);
      return next;
    });
  }, []);

  const value = useMemo<ComponentLibraryContextValue>(() => {
    // Components: merge server + optimistic. Optimistic with a slug
    // that's now in the server list is dropped (server wins on collide,
    // because it has the canonical id). Slug-only-on-optimistic-side
    // gets appended.
    const serverSlugs = new Set(components.map((c) => c.slug));
    const mergedComponents = [...components];
    for (const [slug, c] of optimisticComponents) {
      if (!serverSlugs.has(slug)) mergedComponents.push(c);
    }

    // Assets: same treatment, keyed on id.
    const serverAssetIds = new Set(assets.map((a) => a.id));
    const mergedAssets = [...assets];
    for (const [id, a] of optimisticAssets) {
      if (!serverAssetIds.has(id)) mergedAssets.push(a);
    }

    return {
      bySlug: new Map(mergedComponents.map((c) => [c.slug, c])),
      components: mergedComponents,
      assets: mergedAssets,
      registerOptimisticComponent,
      registerOptimisticAsset,
    };
  }, [
    components,
    assets,
    optimisticComponents,
    optimisticAssets,
    registerOptimisticComponent,
    registerOptimisticAsset,
  ]);

  return (
    <ComponentLibraryContext.Provider value={value}>
      {children}
    </ComponentLibraryContext.Provider>
  );
}

export function useComponentLibrary() {
  return useContext(ComponentLibraryContext);
}
