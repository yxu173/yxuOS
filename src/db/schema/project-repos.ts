import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { user, organization } from "./auth";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * GitHub repositories imported into a project's brain.
 *
 * One row per (project, owner, repo, branch). The actual code is
 * not stored here — it lives in `project_knowledge` as one row per
 * chunk with `source_type = "repo_file"`. This table is the
 * orchestration / progress / metadata layer: it tells the UI which
 * repos exist, where they came from, how far the index pass got,
 * and where to look up the access token when re-syncing.
 *
 * Why a separate table at all (vs piggy-backing on project_knowledge)?
 *   - The brain is keyed on `(source_type, source_id, chunk_index)`
 *     and has no concept of "import status" or "branch SHA".
 *   - We need a stable parent id to scope `search_code` filtering
 *     and to drive bulk-delete on "unlink repo".
 *   - Re-sync needs to know the last indexed SHA to short-circuit
 *     when the remote hasn't moved.
 *
 * Token storage caveat: `accessToken` is stored **as plaintext** for
 * MVP. The expectation is that this codebase runs on a trusted
 * single-tenant host. Migrate to encrypted-at-rest (AES-GCM with a
 * key derived from `BETTER_AUTH_SECRET`) before opening to
 * multi-tenant traffic. The column is null for public repos.
 */
export type RepoStatus = "pending" | "indexing" | "ready" | "failed";

export const projectRepos = pgTable(
  "project_repos",
  {
    id: text("id").primaryKey().$defaultFn(newId),

    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** GitHub owner (user or org). Lowercased on write. */
    owner: text("owner").notNull(),
    /** Repo name. Lowercased on write. */
    repo: text("repo").notNull(),
    /**
     * Branch we're tracking. Captured at import time from
     * `default_branch`; the user can re-sync from a different
     * branch later.
     */
    branch: text("branch").notNull(),

    /**
     * Last commit SHA we successfully indexed. Used to short-circuit
     * re-sync when the remote hasn't moved. Null until the first
     * successful pass.
     */
    lastIndexedSha: text("last_indexed_sha"),

    /**
     * Plaintext GitHub PAT. Null for public repos. See the table
     * doc-comment for the migration plan to encrypted-at-rest.
     */
    accessToken: text("access_token"),

    status: text("status").$type<RepoStatus>().notNull().default("pending"),
    /** Human-readable failure reason; populated when status = failed. */
    error: text("error"),

    /** Total candidate files after filtering. Updated once the tarball is parsed. */
    totalFiles: integer("total_files").notNull().default(0),
    /** Files successfully embedded so far. Updated as the indexer progresses. */
    indexedFiles: integer("indexed_files").notNull().default(0),
    /** Files skipped due to size cap / binary detection / filter rules. */
    skippedFiles: integer("skipped_files").notNull().default(0),

    importedById: text("imported_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    importedAt: timestamp("imported_at").notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    /**
     * One row per (project, owner, repo, branch). Re-importing the
     * same triple is a no-op from the user's perspective; we surface
     * "already imported" in the UI.
     */
    uniqueIndex("project_repos_unique_idx").on(
      t.projectId,
      t.owner,
      t.repo,
      t.branch,
    ),
    index("project_repos_project_idx").on(t.projectId),
    index("project_repos_status_idx").on(t.status),
  ],
);

export type ProjectRepo = typeof projectRepos.$inferSelect;
export type NewProjectRepo = typeof projectRepos.$inferInsert;
