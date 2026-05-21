import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { boardFolders } from "./board-folders";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * One whiteboard per row.
 *
 * - `snapshot` holds the full Excalidraw scene as a single JSONB blob;
 *   we debounce-save the snapshot whenever the user / agent edits the
 *   canvas. Shape is `ExcalidrawSnapshotV1` from
 *   `src/components/board/excalidraw/snapshot.ts`.
 * - `threadId` ties the board to a Mastra memory thread so chat history
 *   survives between sessions.
 */
export const boards = pgTable(
  "boards",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull().default("Untitled board"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Team (organization) that owns this board. Cascades on team delete.
     */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Project the board lives in. Nullable until the Phase 1.2 backfill
     * stamps every existing row, then a follow-up migration flips this
     * to NOT NULL.
     */
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    /**
     * Folder inside the project. Null = root of the project ("Uncategorised").
     * Setting null on folder delete keeps the boards alive when their
     * folder is removed.
     */
    folderId: text("folder_id").references(() => boardFolders.id, {
      onDelete: "set null",
    }),
    threadId: text("thread_id").notNull().$defaultFn(newId),
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    /**
     * Public share token. When set, anyone with the URL `/share/<token>` can
     * view this board read-only (no chat, no editing). Null disables sharing.
     */
    shareToken: text("share_token").unique(),
    /**
     * Board locking for real-time collaboration. When a team member
     * has this board open, `lockedById` is set to prevent concurrent
     * writes by others. The lock is released on disconnect / navigate
     * away, or when another user explicitly takes over.
     *
     * `lockedAt` allows stale-lock detection: if a user's browser
     * crashes, the lock is auto-released after a timeout (handled by
     * the client's polling).
     */
    lockedById: text("locked_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("boards_owner_idx").on(t.ownerId),
    index("boards_team_idx").on(t.teamId),
    index("boards_project_idx").on(t.projectId),
    index("boards_folder_idx").on(t.folderId),
  ],
);

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
