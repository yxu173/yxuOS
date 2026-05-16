"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Light-weight client child that calls `router.refresh()` every 3s
 * while at least one repo is `pending` / `indexing`. The parent
 * RSC re-renders, picks up updated counts from the DB, and either
 * keeps this child mounted (still indexing) or unmounts it
 * (everything settled).
 *
 * Cheap: `router.refresh()` is debounced server-side and only
 * re-runs the RSC tree, not the whole route.
 */
export function RepoPolling() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
