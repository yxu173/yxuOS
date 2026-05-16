"use client";

import { useEffect } from "react";

import { saveDesignSnapshot } from "@/app/(app)/designs/actions";

import { useDesignCanvas } from "./canvas-store";

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Subscribes to artboard mutations and debounce-saves the snapshot back
 * to Postgres via the saveDesignSnapshot server action. Camera state is
 * intentionally *not* persisted — it's UI ephemera, not part of the
 * design.
 *
 * Mirrors the pattern we use for Excalidraw boards (debounced scene
 * listener, last-chance flush on unmount).
 */
export function useDesignPersistence(designId: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const artboards = useDesignCanvas.getState().artboards;
      saveDesignSnapshot(designId, { artboards }).catch((error) => {
        console.error("Failed to save design:", error);
      });
    };

    const unsubscribe = useDesignCanvas.subscribe((state, prev) => {
      // Reference equality is safe: zustand setters always produce a new
      // array on mutation. So this fires on real changes and skips no-ops.
      if (state.artboards === prev.artboards) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });

    return () => {
      if (timer) {
        clearTimeout(timer);
        // Last-chance flush before unmount so closing the tab right after
        // an edit doesn't drop the change.
        flush();
      }
      unsubscribe();
    };
  }, [designId]);
}
