"use client";

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { deleteRepo, resyncRepo } from "@/app/(app)/repos/actions";
import { useToast } from "@/components/ui/toast";

/**
 * Per-row action buttons for an imported repo.
 *
 * `Resync` re-runs the indexer (full re-index for now). `Delete`
 * wipes the repo row + every chunk for it from the brain. Both
 * are server actions; the row's status flip is shown by the
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

  function handleResync() {
    if (disabled) return;
    startResync(async () => {
      try {
        await resyncRepo({ projectSlug, repoId });
        toast.success(`${repoLabel} is re-indexing.`);
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
        title="Re-index"
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
