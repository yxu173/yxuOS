import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";

const newId = () => nanoid();

/**
 * One whiteboard per row.
 *
 * - `snapshot` holds the full tldraw store as a single JSONB blob (MVP); we
 *   debounce-save the snapshot whenever the user / agent edits the canvas.
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
     * Team (organization) that owns this board. Nullable during the
     * teams rollout — phase 2 backfills personal teams for existing
     * rows and then ALTERs the column to NOT NULL with FK.
     */
    teamId: text("team_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id").notNull().$defaultFn(newId),
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    /**
     * Public share token. When set, anyone with the URL `/share/<token>` can
     * view this board read-only (no chat, no editing). Null disables sharing.
     */
    shareToken: text("share_token").unique(),
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
  ],
);

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
