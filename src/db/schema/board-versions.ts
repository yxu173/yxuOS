import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { user } from "./auth";
import { boards } from "./boards";

const newId = () => nanoid();

/**
 * Append-only version history for boards.
 *
 * A new row is inserted every time `saveBoardSnapshot` persists the
 * Excalidraw scene — typically on a 1.5 s debounce during editing.
 * The complete `snapshot` is stored so any version can be restored
 * or diffed.
 */
export const boardVersions = pgTable(
  "board_versions",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
    editedById: text("edited_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("board_versions_board_created_idx").on(t.boardId, t.createdAt),
  ],
);

export type BoardVersion = typeof boardVersions.$inferSelect;
export type NewBoardVersion = typeof boardVersions.$inferInsert;
