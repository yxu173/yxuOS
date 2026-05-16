import {
  AlertCircle,
  CheckCircle2,

  Loader2,
  Lock,
} from "lucide-react";

import type { RepoRow } from "@/app/(app)/repos/actions";
import { listProjectRepos } from "@/app/(app)/repos/actions";

import { RepoImportForm } from "./repo-import-form";
import { RepoPolling } from "./repo-polling";
import { RepoRowActions } from "./repo-row-actions";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.55 0-.27-.01-1.16-.02-2.1-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.71.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.83 0c2.22-1.49 3.2-1.18 3.2-1.18.64 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .3.21.66.8.55C20.21 21.4 23.5 17.09 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

/**
 * Server-rendered list of GitHub repos imported into this project.
 *
 * Rendered above the search box on the brain page. The form lives
 * here so the empty state can tell the user what they're missing
 * ("no repos imported \u2014 paste a URL above"). When at least one
 * repo is mid-indexing, a small client child mounts a polling
 * `router.refresh()` so progress numbers visibly tick up without
 * the user having to hammer F5.
 */
export async function RepoList({ projectSlug }: { projectSlug: string }) {
  const repos = await listProjectRepos(projectSlug);
  const anyActive = repos.some(
    (r) => r.status === "pending" || r.status === "indexing",
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          Imported repos
        </h2>
        <span className="text-xs text-zinc-600">
          {repos.length} / unlimited
        </span>
      </div>

      <RepoImportForm projectSlug={projectSlug} />

      {repos.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
          No repos imported yet. Drop a GitHub URL above and the agents
          will be able to search the code.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {repos.map((r) => (
            <RepoListRow key={r.id} projectSlug={projectSlug} row={r} />
          ))}
        </ul>
      )}

      {anyActive ? <RepoPolling /> : null}
    </section>
  );
}

function RepoListRow({
  projectSlug,
  row,
}: {
  projectSlug: string;
  row: RepoRow;
}) {
  const label = `${row.owner}/${row.repo}`;
  const progressPct =
    row.totalFiles > 0
      ? Math.min(100, Math.round((row.indexedFiles / row.totalFiles) * 100))
      : 0;

  return (
    <li className="group flex items-center gap-3 rounded-md border border-zinc-800/60 bg-zinc-950/30 px-3 py-2 text-sm">
      <GithubIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <a
            href={`https://github.com/${label}/tree/${row.branch}`}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-zinc-100 hover:text-zinc-300"
          >
            {label}
          </a>
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {row.branch}
          </span>
          {row.hasToken ? (
            <Lock className="h-3 w-3 text-zinc-500" aria-label="Private (token attached)" />
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <StatusBadge row={row} />
          {row.status === "indexing" || row.status === "ready" ? (
            <span>
              {row.indexedFiles.toLocaleString()} files
              {row.skippedFiles > 0
                ? ` · ${row.skippedFiles.toLocaleString()} skipped`
                : ""}
            </span>
          ) : null}
          {row.status === "failed" && row.error ? (
            <span className="truncate text-rose-400" title={row.error}>
              {row.error}
            </span>
          ) : null}
        </div>
        {row.status === "indexing" ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-emerald-500/70 transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        ) : null}
      </div>
      <RepoRowActions
        projectSlug={projectSlug}
        repoId={row.id}
        repoLabel={label}
        disabled={row.status === "indexing" || row.status === "pending"}
      />
    </li>
  );
}

function StatusBadge({ row }: { row: RepoRow }) {
  switch (row.status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" /> queued
        </span>
      );
    case "indexing":
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <Loader2 className="h-3 w-3 animate-spin" /> indexing
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center gap-1 text-emerald-500">
          <CheckCircle2 className="h-3 w-3" /> ready
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-rose-400">
          <AlertCircle className="h-3 w-3" /> failed
        </span>
      );
  }
}
