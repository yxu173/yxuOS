import { chunkCodeFile } from "../chunk-code";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

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
}

export type RepoFileIndexResult =
  | { ok: true; chunkCount: number }
  | { ok: false; reason: string };

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
 * user deletes a repo or kicks off a forced re-sync that wants
 * to start clean.
 */
export async function unindexRepo(repoId: string): Promise<void> {
  try {
    // We can't use `deleteKnowledgeForSource` directly because
    // each file has a different `sourceId`. The repo-wide delete
    // is implemented in `../upsert.ts` as `deleteKnowledgeForRepoFiles`.
    const { deleteKnowledgeForRepoFiles } = await import("../upsert");
    await deleteKnowledgeForRepoFiles(repoId);
  } catch (err) {
    console.error(
      `[rag/repo-file] unindexRepo(${repoId}) failed:`,
      formatRagError(err),
    );
  }
}
