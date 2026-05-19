import { eq } from "drizzle-orm";

import { db } from "@/db";
import { projectRepos } from "@/db/schema";
import {
  fetchBranchSha,
  GitHubFetchError,
  streamRepoFiles,
} from "@/lib/repos/github";

import { formatRagError } from "../log";
import {
  hashFileContent,
  indexRepoFile,
  loadRepoFileHashes,
  prunePathsRemovedFromRepo,
  unindexRepo,
} from "./repo-file";

/**
 * Whole-repo indexing orchestrator.
 *
 * Drives one end-to-end pass: fetch tarball, classify files, chunk
 * each kept file, embed + persist, and update progress + status on
 * the `project_repos` row so the UI can poll for progress.
 *
 * # What changed vs the v1 design
 *
 * v1 wiped every prior chunk for the repo at the top of the pass
 * and re-embedded every file from scratch. Embeddings dominate
 * indexing cost (latency + $$$), and ~95% of files don't change
 * between resyncs, so this was the single biggest waste in the
 * pipeline. v2 (this file) is **incremental**:
 *
 *   1. **SHA short-circuit.** If `lastIndexedSha === HEAD`, the
 *      branch hasn't moved \u2014 mark `ready` and return. The cost is
 *      one cheap GitHub branch lookup; the benefit is a no-op
 *      resync on an unchanged repo.
 *
 *   2. **Per-file hash diff.** Before the tarball stream, load the
 *      `path \u2192 fileContentHash` map for every file currently
 *      indexed (one SQL query, restricted to `chunk_index = 0`).
 *      During the stream, hash each decoded file; if the hash
 *      matches what we already have, mark the path "seen" and skip
 *      chunking + embedding entirely. Files that genuinely
 *      changed (or are new) take the slow path through
 *      `indexRepoFile`, which itself only re-embeds the chunks
 *      whose content hash changed (the in-place dedupe layer in
 *      `upsertKnowledge`).
 *
 *   3. **Seen-set prune.** After a successful pass, delete chunks
 *      for any previously-indexed path that wasn't seen this round
 *      (file deleted, renamed, or moved under an ignored dir).
 *      One batched DELETE, scoped to the actually-removed paths
 *      \u2014 never the whole repo.
 *
 * Net effect: a resync of an unchanged 5k-file repo went from
 * "re-embed all 5k files" to "one branch-SHA lookup, return". A
 * resync after a 10-file change indexes 10 files.
 *
 * # Memory / streaming
 *
 * Tarball entries are still processed one at a time. The diff map
 * is ~64 bytes per file (path + sha256 hex) which is bounded by
 * the file-count cap (50k) \u2014 a few megabytes worst-case, fine.
 *
 * # Progress
 *
 * `indexedFiles` now counts files we KEPT in the brain after this
 * pass (changed-and-embedded plus unchanged-and-reused), so the
 * UI's progress bar reflects "files searchable now", not "files
 * we embedded this run". A separate field could expose the
 * cheap/expensive split if the UI ever wants to surface it.
 *
 * # Failure model
 *
 * On thrown error, status flips to `failed`, partial progress is
 * preserved, and **no prune happens**. That keeps already-indexed
 * files searchable even after a failed resync. The next attempt
 * picks up where this one left off.
 */

const PROGRESS_FLUSH_EVERY = 25;

/**
 * If an `indexing` row hasn't moved in this long, we assume the
 * previous run was killed (e.g. dev-server hot reload, Vercel
 * function timeout, OOM) and treat the row as resumable. Five
 * minutes is comfortable: even a 5k-file repo flushes progress
 * every 25 files, so a healthy run updates `updatedAt` every
 * few seconds.
 */
const STUCK_INDEXING_TIMEOUT_MS = 5 * 60 * 1000;

export async function runRepoIndex(repoId: string): Promise<void> {
  const repo = await db.query.projectRepos.findFirst({
    where: eq(projectRepos.id, repoId),
  });
  if (!repo) {
    // Row was deleted between scheduling and running. Nothing to
    // do; the delete action's `unindexRepo` already wiped chunks.
    return;
  }

  // Idempotency: if another caller is *actively* indexing this
  // row, don't double-run. "Actively" = `updatedAt` is recent.
  // A stale `indexing` row means the previous worker was killed
  // (dev reload, function timeout) and we must take over, not
  // sit on our hands forever.
  if (repo.status === "indexing") {
    const ageMs = Date.now() - new Date(repo.updatedAt).getTime();
    if (ageMs < STUCK_INDEXING_TIMEOUT_MS) {
      console.warn(
        `[rag/repo] skipping ${repoId} — already indexing (${Math.round(ageMs / 1000)}s ago)`,
      );
      return;
    }
    console.warn(
      `[rag/repo] taking over stale indexing run for ${repoId} (${Math.round(ageMs / 1000)}s stale)`,
    );
  }

  // ── SHA short-circuit ────────────────────────────────────
  //
  // Resolve HEAD up-front. If it matches what we already indexed,
  // there's no work to do. We flip status to `ready` and refresh
  // `lastSyncedAt` so the UI shows "synced just now" \u2014 same UX as
  // a successful resync, but the cost is one branch lookup.
  let headSha: string;
  try {
    headSha = await fetchBranchSha(
      repo.owner,
      repo.repo,
      repo.branch,
      repo.accessToken,
    );
  } catch (err) {
    const msg =
      err instanceof GitHubFetchError
        ? `${err.kind}: ${err.message}`
        : formatRagError(err);
    console.error(`[rag/repo] ${repoId} SHA lookup failed:`, msg);
    await db
      .update(projectRepos)
      .set({
        status: "failed",
        error: msg.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));
    return;
  }

  if (repo.lastIndexedSha && repo.lastIndexedSha === headSha) {
    console.log(
      `[rag/repo] ${repo.owner}/${repo.repo}@${repo.branch} unchanged (${headSha.slice(0, 7)}) — no-op resync`,
    );
    await db
      .update(projectRepos)
      .set({
        status: "ready",
        error: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));
    return;
  }

  // Transition: pending|ready|failed → indexing
  await db
    .update(projectRepos)
    .set({
      status: "indexing",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(projectRepos.id, repoId));

  // ── Existing-file hash map ──────────────────────────────
  //
  // One round-trip. Empty map on first-pass / after a manual
  // wipe \u2014 every file then takes the slow path, as expected.
  const existingHashes = await loadRepoFileHashes(repo.id);

  // Track every path we encountered THIS pass so we can prune
  // the difference (removed-from-repo paths) at the end.
  const seenPaths = new Set<string>();

  let kept = 0; // files searchable in the brain after this pass
  let reused = 0; // subset of `kept` whose hash matched (no embed)
  let embedded = 0; // subset of `kept` we had to re-embed
  let skipped = 0; // files filtered out (binary, too_large, ignored dir, …)
  let failedFiles = 0;
  let sinceFlush = 0;
  const failureReasons: Record<string, number> = {};

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

          const fileContentHash = hashFileContent(content);

          // Fast path: hash matches the one we stored last pass.
          // Nothing to do \u2014 the chunks are already in place with
          // correct embeddings. Counting it as `kept` keeps the
          // UI's "indexed files" number meaningful (= files
          // searchable right now).
          if (existingHashes.get(path) === fileContentHash) {
            seenPaths.add(path);
            kept++;
            reused++;
            sinceFlush++;
            if (sinceFlush >= PROGRESS_FLUSH_EVERY) await flush();
            return;
          }

          // Slow path: chunk + embed + upsert.
          const result = await indexRepoFile({
            teamId: repo.teamId,
            projectId: repo.projectId,
            repoId: repo.id,
            repoOwner: repo.owner,
            repoName: repo.repo,
            branch: repo.branch,
            path,
            content,
            sha: headSha,
            fileContentHash,
          });

          if (result.ok) {
            seenPaths.add(path);
            kept++;
            embedded++;
          } else {
            failedFiles++;
            // Log only the first few; otherwise a syntax-error
            // repo would flood the logs. The per-reason bucket
            // count below gives an aggregate signal for the rest.
            if (failedFiles <= 5) {
              console.warn(
                `[rag/repo] ${repo.owner}/${repo.repo} — file ${path} failed: ${result.reason}`,
              );
            }
            failureReasons[result.reason] =
              (failureReasons[result.reason] ?? 0) + 1;
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

    // ── Prune paths that disappeared from the repo ──────────
    //
    // Only runs on a clean pass (no thrown error). On partial
    // failure we leave existing chunks alone so they stay
    // searchable until the next successful resync.
    const pruned = await prunePathsRemovedFromRepo(
      repo.id,
      existingHashes.keys(),
      seenPaths,
    );

    const failureSummary =
      failedFiles > 0
        ? `${failedFiles} file(s) failed: ${Object.entries(failureReasons)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`
        : null;

    await db
      .update(projectRepos)
      .set({
        status: "ready",
        indexedFiles: kept,
        skippedFiles: skipped,
        totalFiles: kept + skipped + failedFiles,
        lastIndexedSha: headSha,
        lastSyncedAt: new Date(),
        error: failureSummary,
        updatedAt: new Date(),
      })
      .where(eq(projectRepos.id, repoId));

    console.log(
      `[rag/repo] indexed ${repo.owner}/${repo.repo}@${repo.branch}` +
        `@${headSha.slice(0, 7)} — ${kept} files (${embedded} embedded, ` +
        `${reused} reused), ${pruned} pruned, ${skipped} skipped, ` +
        `${failedFiles} failed${failureSummary ? ` (${failureSummary})` : ""}`,
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

/**
 * Force a full re-index from scratch. Wipes every chunk for the
 * repo and clears `lastIndexedSha` so the next `runRepoIndex` call
 * takes the slow path on every file. Use sparingly \u2014 the normal
 * resync is now incremental and almost always cheaper.
 *
 * Useful when:
 *   - The embedding model changes (chunk metadata becomes stale).
 *   - The chunker logic changes in a way that affects boundaries.
 *   - A user reports stale search hits and wants a guaranteed reset.
 */
export async function forceFullReindex(repoId: string): Promise<void> {
  await unindexRepo(repoId);
  await db
    .update(projectRepos)
    .set({
      lastIndexedSha: null,
      status: "pending",
      error: null,
      indexedFiles: 0,
      skippedFiles: 0,
      totalFiles: 0,
      updatedAt: new Date(),
    })
    .where(eq(projectRepos.id, repoId));
}
