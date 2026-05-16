import { eq } from "drizzle-orm";

import { db } from "@/db";
import { projectRepos } from "@/db/schema";
import {
  fetchBranchSha,
  GitHubFetchError,
  streamRepoFiles,
} from "@/lib/repos/github";

import { formatRagError } from "../log";
import { indexRepoFile, unindexRepo } from "./repo-file";

/**
 * Whole-repo indexing orchestrator.
 *
 * Drives one end-to-end pass: fetch tarball, classify files, chunk
 * each kept file, embed + persist, and update progress + status on
 * the `project_repos` row so the UI can poll for progress.
 *
 * Design notes:
 *
 * - **Streamed.** Files are processed one at a time as they fall
 *   out of the tar parser. Memory stays bounded.
 *
 * - **Progress is committed in batches.** Updating `indexed_files`
 *   after every single file would multiply DB writes by 25x with
 *   no UX benefit. We flush every PROGRESS_FLUSH_EVERY files or
 *   on terminal events.
 *
 * - **Self-cleanup on full re-index.** Before the pass starts we
 *   wipe every prior chunk for this repo. Cheaper than diffing
 *   per-file and lets the per-file indexer stay free of
 *   "is-this-the-first-pass" branching. The catch: re-syncing a
 *   5k-file repo re-embeds 5k files even if nothing changed. We
 *   accept that cost in MVP; SHA-aware skipping is a follow-up.
 *
 * - **Status transitions:** `pending` → `indexing` → `ready` |
 *   `failed`. The UI never sees an inconsistent intermediate
 *   state because each transition is one SQL update.
 *
 * - **Errors are caught at the boundary.** Any throw inside the
 *   pass flips status to `failed` and records the error message;
 *   it does not propagate out. The caller is `after(...)` — there
 *   is no user-visible request waiting on this.
 */

const PROGRESS_FLUSH_EVERY = 25;

export async function runRepoIndex(repoId: string): Promise<void> {
  const repo = await db.query.projectRepos.findFirst({
    where: eq(projectRepos.id, repoId),
  });
  if (!repo) {
    // Row was deleted between scheduling and running. Nothing to
    // do; the delete action's `unindexRepo` already wiped chunks.
    return;
  }

  // Idempotency: if another caller already moved this row from
  // pending → indexing, don't double-run.
  if (repo.status === "indexing") {
    console.warn(`[rag/repo] skipping ${repoId} — already indexing`);
    return;
  }

  // Transition: pending|ready|failed → indexing
  await db
    .update(projectRepos)
    .set({
      status: "indexing",
      error: null,
      totalFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      updatedAt: new Date(),
    })
    .where(eq(projectRepos.id, repoId));

  // Clean slate. Cheap full-reset; we'll repopulate as files
  // flow through.
  await unindexRepo(repoId);

  let kept = 0;
  let skipped = 0;
  let failedFiles = 0;
  let sinceFlush = 0;

  const flush = async () => {
    sinceFlush = 0;
    await db
      .update(projectRepos)
      .set({
        indexedFiles: kept,
        skippedFiles: skipped,
        totalFiles: kept + skipped + failedFiles,
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));
  };

  try {
    // Resolve the tip SHA before streaming so we can persist it
    // on success even if the tarball stream uses a different ref form.
    const sha = await fetchBranchSha(
      repo.owner,
      repo.repo,
      repo.branch,
      repo.accessToken,
    );

    await streamRepoFiles(
      repo.owner,
      repo.repo,
      repo.branch,
      repo.accessToken,
      {
        onFile: async ({ path, bytes }) => {
          // Decode UTF-8. Files that fail decoding here slipped
          // past the binary sniff — treat as skipped.
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          } catch {
            skipped++;
            return;
          }
          const result = await indexRepoFile({
            teamId: repo.teamId,
            projectId: repo.projectId,
            repoId: repo.id,
            repoOwner: repo.owner,
            repoName: repo.repo,
            branch: repo.branch,
            path,
            content,
            sha,
          });
          if (result.ok) {
            kept++;
          } else {
            failedFiles++;
            // Log only the first few; otherwise a syntax-error
            // repo would flood the logs.
            if (failedFiles <= 5) {
              console.warn(
                `[rag/repo] ${repo.owner}/${repo.repo} — file ${path} failed: ${result.reason}`,
              );
            }
          }
          sinceFlush++;
          if (sinceFlush >= PROGRESS_FLUSH_EVERY) {
            await flush();
          }
        },
        onSkip: () => {
          skipped++;
          sinceFlush++;
          if (sinceFlush >= PROGRESS_FLUSH_EVERY) {
            // Fire-and-forget flush — the next kept-file await
            // serialises us if it's still in flight.
            void flush();
          }
        },
      },
    );

    // Terminal flush + status flip.
    await db
      .update(projectRepos)
      .set({
        status: "ready",
        indexedFiles: kept,
        skippedFiles: skipped,
        totalFiles: kept + skipped + failedFiles,
        lastIndexedSha: sha,
        lastSyncedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));

    console.log(
      `[rag/repo] indexed ${repo.owner}/${repo.repo}@${repo.branch} — ${kept} files, ${skipped} skipped, ${failedFiles} failed`,
    );
  } catch (err) {
    const msg =
      err instanceof GitHubFetchError
        ? `${err.kind}: ${err.message}`
        : formatRagError(err);
    console.error(`[rag/repo] ${repoId} failed:`, msg);
    await db
      .update(projectRepos)
      .set({
        status: "failed",
        error: msg.slice(0, 500),
        // Keep partial progress visible so the UI can show
        // "123 files indexed before failure".
        indexedFiles: kept,
        skippedFiles: skipped,
        totalFiles: kept + skipped + failedFiles,
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));
  }
}

/**
 * Mark a repo as queued for indexing. Used by import / re-sync
 * actions before they hand off to `runRepoIndex` via `after()`.
 * Separated from `runRepoIndex` so the server action can return
 * synchronously while the background work happens.
 */
export async function markRepoPending(repoId: string): Promise<void> {
  await db
    .update(projectRepos)
    .set({
      status: "pending",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(projectRepos.id, repoId));
}
