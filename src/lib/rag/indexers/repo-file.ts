import { createHash } from "node:crypto";

import { and, eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { projectKnowledge } from "@/db/schema/project-knowledge";

import { chunkCodeFile } from "../chunk-code";
import { formatRagError } from "../log";
import {
  deleteKnowledgeForRepoPaths,
  deleteKnowledgeForSource,
  upsertKnowledge,
} from "../upsert";

/**
 * Per-file RAG indexer for **imported GitHub repos**.
 *
 * Unlike the artifact indexers (research notes, plans, tasks),
 * code files don't have their own DB row. The unit of identity is
 * the (repo, path) pair, encoded as `sourceId = "<repoId>:<path>"`.
 * The whole-repo orchestrator (`indexers/repo.ts`) calls this
 * function once per kept file.
 *
 * Contract:
 *
 * - **Never throws.** A single file failing must not abort the
 *   whole-repo pass.
 *
 * - **Returns a summary** so the orchestrator can update progress
 *   counters and decide whether to mark the repo `failed` if too
 *   many files in a row fail.
 *
 * - **Source-id format is stable.** `search_code` and `read_file`
 *   parse it back to (repoId, path); changing the separator here
 *   means changing it everywhere.
 *
 * - **Metadata persisted with every chunk:** repoId, path,
 *   pre-computed startLine/endLine (from the chunk anchor). This
 *   keeps search results cite-able without joining back to the
 *   repos table on render.
 */

export interface RepoFileIndexInput {
  teamId: string;
  projectId: string;
  repoId: string;
  /** GitHub owner login. Stored in metadata so the brain UI can build deep links without a join. */
  repoOwner: string;
  /** GitHub repo name. Same reason as `repoOwner`. */
  repoName: string;
  /** Branch name — used by the UI to build `github.com/.../blob/<branch>/<path>` when no SHA is available. */
  branch: string;
  /** Repo-relative file path, e.g. `"src/auth.ts"`. */
  path: string;
  /** Decoded file contents. Pre-filtered to non-binary text. */
  content: string;
  /** Branch tip SHA the file was read at. */
  sha: string | null;
  /**
   * SHA-256 of the decoded file content. The orchestrator computes
   * this once and passes it through so it can be stored on every
   * chunk's metadata — enabling O(1) skip on the next resync when
   * the file hasn't changed.
   */
  fileContentHash: string;
}

export type RepoFileIndexResult =
  | { ok: true; chunkCount: number }
  | { ok: false; reason: string };

/** SHA-256 hex of a file's decoded UTF-8 content. */
export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildRepoFileSourceId(repoId: string, filePath: string): string {
  return `${repoId}:${filePath}`;
}

export function parseRepoFileSourceId(
  sourceId: string,
): { repoId: string; path: string } | null {
  const idx = sourceId.indexOf(":");
  if (idx === -1) return null;
  return {
    repoId: sourceId.slice(0, idx),
    path: sourceId.slice(idx + 1),
  };
}

export async function indexRepoFile(
  input: RepoFileIndexInput,
): Promise<RepoFileIndexResult> {
  try {
    const chunks = await chunkCodeFile(input.content, {
      filePath: input.path,
    });
    if (chunks.length === 0) {
      // Empty after stripping whitespace — still treat as a
      // success so the file count stays accurate, but make sure
      // any prior chunks for this file are wiped.
      await deleteKnowledgeForSource(
        "repo_file",
        buildRepoFileSourceId(input.repoId, input.path),
      );
      return { ok: true, chunkCount: 0 };
    }
    await upsertKnowledge({
      teamId: input.teamId,
      projectId: input.projectId,
      sourceType: "repo_file",
      sourceId: buildRepoFileSourceId(input.repoId, input.path),
      // `title` shows up in the search UI as the row's clickable
      // header. For code, the path is the most useful title.
      title: input.path,
      metadata: {
        repoId: input.repoId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        branch: input.branch,
        path: input.path,
        sha: input.sha,
        // Persisted on every chunk; the orchestrator queries
        // `chunk_index = 0` rows on the next resync to decide
        // whether the file changed without re-chunking it.
        fileContentHash: input.fileContentHash,
      },
      chunks,
    });
    return { ok: true, chunkCount: chunks.length };
  } catch (err) {
    return { ok: false, reason: formatRagError(err) };
  }
}

/**
 * Wipe every chunk for every file under a repo. Called when the
 * user deletes a repo. **No longer called at the start of an
 * index pass** — the orchestrator now diffs by `fileContentHash`
 * and prunes only the paths that actually disappeared, so a
 * resync of an unchanged repo is essentially free.
 */
export async function unindexRepo(repoId: string): Promise<void> {
  try {
    const { deleteKnowledgeForRepoFiles } = await import("../upsert");
    await deleteKnowledgeForRepoFiles(repoId);
  } catch (err) {
    console.error(
      `[rag/repo-file] unindexRepo(${repoId}) failed:`,
      formatRagError(err),
    );
  }
}

/**
 * Load the per-file content hash for every file currently indexed
 * under `repoId`. Returns a `path → hash` map the orchestrator uses
 * to decide which files actually changed since last pass.
 *
 * We read `chunk_index = 0` only because every chunk of one file
 * carries the same `fileContentHash` in metadata, so chunk 0 is a
 * unique row-per-file. That collapses the result set from O(chunks)
 * (~50k for a 5k-file repo) to O(files) (~5k) without needing a
 * `DISTINCT` aggregate — the existing `(sourceType, sourceId,
 * chunkIndex)` unique index makes this a cheap range scan.
 *
 * Files indexed before the `fileContentHash` field landed will
 * return `null`. The orchestrator treats `null` as "unknown → must
 * re-index", which is the correct conservative behaviour for the
 * one-shot migration window.
 */
export async function loadRepoFileHashes(
  repoId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({
      sourceId: projectKnowledge.sourceId,
      // `metadata` is jsonb; extract the text field directly so we
      // don't drag the whole JSON over the wire for 5k rows.
      hash: sql<string | null>`(${projectKnowledge.metadata} ->> 'fileContentHash')`,
    })
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, "repo_file"),
        like(projectKnowledge.sourceId, `${repoId}:%`),
        eq(projectKnowledge.chunkIndex, 0),
      ),
    );

  const out = new Map<string, string | null>();
  for (const row of rows) {
    const parsed = parseRepoFileSourceId(row.sourceId);
    if (!parsed) continue;
    out.set(parsed.path, row.hash ?? null);
  }
  return out;
}

/**
 * After a pass, remove chunks for any path that disappeared from
 * the repo (file deleted, renamed, or moved into an ignored
 * directory). Takes the set of paths actually seen during this
 * pass and the map of paths previously indexed; deletes the
 * difference in one batch.
 */
export async function prunePathsRemovedFromRepo(
  repoId: string,
  previousPaths: Iterable<string>,
  seenPaths: Set<string>,
): Promise<number> {
  const toRemove: string[] = [];
  for (const path of previousPaths) {
    if (!seenPaths.has(path)) toRemove.push(path);
  }
  if (toRemove.length === 0) return 0;
  await deleteKnowledgeForRepoPaths(repoId, toRemove);
  return toRemove.length;
}
