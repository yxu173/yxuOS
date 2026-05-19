"use client";

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useTransition } from "react";

import {
  deleteRepo,
  forceReindexRepo,
  resyncRepo,
} from "@/app/(app)/repos/actions";
import { useToast } from "@/components/ui/toast";

/**
 * Per-row action buttons for an imported repo.
 *
 * `Resync` (click) runs the cheap incremental indexer — SHA
 * short-circuit, hash-diff per file, prune-only-removed-paths.
 * Resyncing an unchanged repo is essentially free.
 *
 * `Force re-index` (Shift+click on Resync) wipes every chunk and
 * starts from scratch. Use after an embedding-model or chunker
 * change, or as a last resort for stale-result reports.
 *
 * `Delete` wipes the repo row + every chunk for it. All three are
 * server actions; the row's status flip is shown by the
 * server-side rerender after `router.refresh()`.
 */
export function RepoRowActions({
  projectSlug,
  repoId,
  repoLabel,
  disabled,
}: {
  projectSlug: string;
  repoId: string;
  repoLabel: string;
  /** True while the row is mid-indexing — Resync becomes a no-op then. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [resyncing, startResync] = useTransition();
  const [deleting, startDelete] = useTransition();

  function handleResync(e: MouseEvent<HTMLButtonElement>) {
    if (disabled) return;
    // Shift+click escalates to a full reindex — power-user escape
    // hatch. Confirm explicitly because it costs real embedding
    // budget on big repos.
    const force = e.shiftKey;
    if (force && !confirm(`Force full re-index of ${repoLabel}?`)) {
      return;
    }
    startResync(async () => {
      try {
        if (force) {
          await forceReindexRepo({ projectSlug, repoId });
          toast.success(`${repoLabel} is being rebuilt from scratch.`);
        } else {
          await resyncRepo({ projectSlug, repoId });
          toast.success(`${repoLabel} is re-indexing.`);
        }
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Resync failed.");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Remove ${repoLabel} from the brain?`)) return;
    startDelete(async () => {
      try {
        await deleteRepo({ projectSlug, repoId });
        toast.success(`${repoLabel} removed from brain.`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Remove failed.");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleResync}
        disabled={disabled || resyncing || deleting}
        title="Re-index (Shift+click to force full rebuild)"
        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-30"
      >
        {resyncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting || resyncing}
        title="Remove from brain"
        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-rose-300 disabled:opacity-30"
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
