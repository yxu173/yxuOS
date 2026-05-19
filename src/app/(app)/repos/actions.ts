"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/db";
import { projectRepos, type ProjectRepo, type RepoStatus } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveProject } from "@/lib/permissions";
import { unindexRepo } from "@/lib/rag/indexers/repo-file";
import {
  forceFullReindex,
  markRepoPending,
  runRepoIndex,
} from "@/lib/rag/indexers/repo";
import {
  fetchRepoMetadata,
  GitHubFetchError,
} from "@/lib/repos/github";
import { parseGitHubUrl } from "@/lib/repos/url";

/**
 * Server actions for **GitHub repo imports** into a project's brain.
 *
 * Permission model: all actions go through `requireActiveProject`
 * so the project slug from the URL is validated against the
 * caller's team membership. Repos themselves are scoped by
 * `(team_id, project_id)`; we never trust a `repoId` from the
 * client without re-confirming it belongs to the active project.
 *
 * Background work: `importRepo` and `resyncRepo` schedule the
 * actual indexing via `after(...)`. The server action returns
 * immediately so the UI can flip to a "pending" state and start
 * polling; the indexer runs against the same request lifetime on
 * Vercel (up to the function's max duration). For repos that
 * exceed that budget, the operator can swap `after()` for a real
 * job queue without touching anything else here.
 */

/* ─── shapes ──────────────────────────────────────────── */

export interface RepoRow {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  status: RepoStatus;
  error: string | null;
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  importedAt: Date;
  lastSyncedAt: Date | null;
  hasToken: boolean;
}

function toRow(r: ProjectRepo): RepoRow {
  return {
    id: r.id,
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    status: r.status,
    error: r.error,
    totalFiles: r.totalFiles,
    indexedFiles: r.indexedFiles,
    skippedFiles: r.skippedFiles,
    importedAt: r.importedAt,
    lastSyncedAt: r.lastSyncedAt,
    hasToken: r.accessToken != null && r.accessToken.length > 0,
  };
}

/* ─── list ────────────────────────────────────────────── */

/**
 * Rows in `indexing` with no progress update in this long are
 * treated as stuck (worker died) and auto-recovered when the brain
 * page loads. Matches `STUCK_INDEXING_TIMEOUT_MS` in the orchestrator.
 */
const STUCK_INDEXING_TIMEOUT_MS = 5 * 60 * 1000;

export async function listProjectRepos(
  projectSlug: string,
): Promise<RepoRow[]> {
  const { projectId } = await requireActiveProject(projectSlug);
  const rows = await db.query.projectRepos.findMany({
    where: eq(projectRepos.projectId, projectId),
    orderBy: [desc(projectRepos.importedAt)],
  });

  // Self-heal stuck rows on render. The list endpoint is hit on
  // every brain-page visit and every poll tick, so a row left
  // dangling by a killed worker (dev-server reload, function
  // timeout) bounces back to `pending` within ~5 minutes and the
  // next user action / poll picks it up. We don't auto-rerun
  // indexing here — just clear the lock and surface the failure
  // so the user can hit Resync.
  const now = Date.now();
  const stuck = rows.filter(
    (r) =>
      r.status === "indexing" &&
      now - new Date(r.updatedAt).getTime() > STUCK_INDEXING_TIMEOUT_MS,
  );
  if (stuck.length > 0) {
    for (const r of stuck) {
      await db
        .update(projectRepos)
        .set({
          status: "failed",
          error:
            "Indexing worker stopped responding. Click Resync to retry.",
          updatedAt: new Date(),
        })
        .where(eq(projectRepos.id, r.id));
      r.status = "failed";
      r.error = "Indexing worker stopped responding. Click Resync to retry.";
    }
  }

  return rows.map(toRow);
}

/* ─── import ──────────────────────────────────────────── */

export interface ImportRepoInput {
  projectSlug: string;
  url: string;
  /** Optional PAT for private repos / higher rate limits. */
  accessToken?: string | null;
  /** Override branch; defaults to the repo's default branch. */
  branch?: string | null;
}

export async function importRepo(
  input: ImportRepoInput,
): Promise<{ repoId: string; existed: boolean }> {
  const { teamId, projectId, session } = await requireActiveProject(
    input.projectSlug,
  );

  const parsed = parseGitHubUrl(input.url);
  const token = (input.accessToken ?? "").trim() || null;

  // Validate against GitHub up-front. We want to fail the import
  // form synchronously when the repo doesn't exist or the token's
  // wrong — much better UX than letting the background job fail
  // silently 5 minutes later.
  let meta;
  try {
    meta = await fetchRepoMetadata(parsed.owner, parsed.repo, token);
  } catch (err) {
    if (err instanceof GitHubFetchError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const branch =
    (input.branch?.trim() || parsed.branch || meta.defaultBranch).trim();

  // De-dupe: same (project, owner, repo, branch) returns the
  // existing row. Re-syncing is the user's responsibility — we
  // don't want a re-import to silently wipe progress.
  const existing = await db.query.projectRepos.findFirst({
    where: and(
      eq(projectRepos.projectId, projectId),
      eq(projectRepos.owner, meta.owner.toLowerCase()),
      eq(projectRepos.repo, meta.repo.toLowerCase()),
      eq(projectRepos.branch, branch),
    ),
  });
  if (existing) {
    return { repoId: existing.id, existed: true };
  }

  const [inserted] = await db
    .insert(projectRepos)
    .values({
      teamId,
      projectId,
      owner: meta.owner.toLowerCase(),
      repo: meta.repo.toLowerCase(),
      branch,
      accessToken: token,
      status: "pending",
      importedById: session.user.id,
    })
    .returning();

  // Kick off the indexer in the background. The server action
  // returns the row id immediately; the UI polls for status.
  after(() => runRepoIndex(inserted.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "repo",
    subjectId: inserted.id,
    subjectName: `${meta.owner}/${meta.repo}`,
    metadata: { branch, action: "import" },
  });

  revalidatePath(`/p/${input.projectSlug}/brain`);
  return { repoId: inserted.id, existed: false };
}

/* ─── resync ──────────────────────────────────────────── */

/**
 * Cheap incremental resync. `runRepoIndex` no-ops when
 * `lastIndexedSha === HEAD`, hash-diffs every file against the
 * previously-stored content hash to skip unchanged ones before
 * chunking / embedding, and prunes only the paths that disappeared
 * from the repo. Resyncing an unchanged repo is ~one GitHub
 * branch-SHA lookup; a small diff costs proportional to the diff.
 * Use {@link forceReindexRepo} for a full wipe.
 */
export async function resyncRepo(input: {
  projectSlug: string;
  repoId: string;
}): Promise<void> {
  const { projectId, teamId, session } = await requireActiveProject(
    input.projectSlug,
  );

  const repo = await db.query.projectRepos.findFirst({
    where: and(
      eq(projectRepos.id, input.repoId),
      eq(projectRepos.projectId, projectId),
    ),
  });
  if (!repo) {
    throw new Error("Repo not found in this project.");
  }
  // `markRepoPending` flips status unconditionally back to `pending`.
  // We deliberately do NOT bail on an existing `indexing` row here:
  // a dev-server hot-reload or a serverless function timeout can
  // leave a row marked `indexing` with no worker actually running.
  // The user clicking Resync is the recovery path; making them wait
  // for a 5-minute staleness window would be hostile UX. The
  // `runRepoIndex` orchestrator has its own takeover logic for the
  // automatic case, but for an explicit user click we just go.
  await markRepoPending(repo.id);
  after(() => runRepoIndex(repo.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "executed",
    subjectType: "repo",
    subjectId: repo.id,
    subjectName: `${repo.owner}/${repo.repo}`,
    metadata: { branch: repo.branch, action: "resync" },
  });

  revalidatePath(`/p/${input.projectSlug}/brain`);
}

/* ─── force full reindex ──────────────────────── */

/**
 * Nukes every chunk for this repo and re-indexes from scratch.
 * Use when an incremental resync can't pick up a needed change —
 * embedding-model swap, chunker-logic change, or a user-reported
 * stale-result that survives a normal resync.
 *
 * Same auth + activity-log surface as `resyncRepo`; differs only
 * in the orchestration call.
 */
export async function forceReindexRepo(input: {
  projectSlug: string;
  repoId: string;
}): Promise<void> {
  const { projectId, teamId, session } = await requireActiveProject(
    input.projectSlug,
  );

  const repo = await db.query.projectRepos.findFirst({
    where: and(
      eq(projectRepos.id, input.repoId),
      eq(projectRepos.projectId, projectId),
    ),
  });
  if (!repo) {
    throw new Error("Repo not found in this project.");
  }

  await forceFullReindex(repo.id);
  after(() => runRepoIndex(repo.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "executed",
    subjectType: "repo",
    subjectId: repo.id,
    subjectName: `${repo.owner}/${repo.repo}`,
    metadata: { branch: repo.branch, action: "force_reindex" },
  });

  revalidatePath(`/p/${input.projectSlug}/brain`);
}

/* ─── delete ──────────────────────────────────────────── */

export async function deleteRepo(input: {
  projectSlug: string;
  repoId: string;
}): Promise<void> {
  const { projectId, teamId, session } = await requireActiveProject(
    input.projectSlug,
  );

  const repo = await db.query.projectRepos.findFirst({
    where: and(
      eq(projectRepos.id, input.repoId),
      eq(projectRepos.projectId, projectId),
    ),
  });
  if (!repo) {
    return;
  }

  // Wipe brain chunks first; if the row delete fails after that
  // the user can re-trigger and we end up consistent. Reversing
  // the order would leave orphan chunks if the chunk delete
  // failed mid-way.
  await unindexRepo(repo.id);
  await db.delete(projectRepos).where(eq(projectRepos.id, repo.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "repo",
    subjectId: repo.id,
    subjectName: `${repo.owner}/${repo.repo}`,
  });

  revalidatePath(`/p/${input.projectSlug}/brain`);
}
