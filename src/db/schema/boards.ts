import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { user } from "./auth";

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
    threadId: text("thread_id").notNull().$defaultFn(newId),
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("boards_owner_idx").on(t.ownerId)],
);

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
