import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { projects } from "./projects";

const newId = () => nanoid();

/**
 * Folder for organising boards inside a project. Supports arbitrary
 * nesting via a self-referencing `parent_folder_id` — top-level folders
 * have it `null`, sub-folders point at their parent.
 *
 * - Cascades on project delete (the project owns its folders).
 * - Deleting a parent folder cascades to its children — the entire
 *   sub-tree of folders is removed in one go. Boards inside those
 *   folders get their `folder_id` set to null (defined on the boards
 *   table), so the boards survive and become "uncategorised" in the
 *   project root.
 */
export const boardFolders = pgTable(
  "board_folders",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null for top-level folders. */
    parentFolderId: text("parent_folder_id"),
    name: text("name").notNull(),
    /** Optional accent — re-uses the project palette idea. */
    color: text("color"),
    /** Manual ordering inside the parent. Default 0; ties broken by name. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("board_folders_project_idx").on(t.projectId),
    index("board_folders_parent_idx").on(t.parentFolderId),
    foreignKey({
      columns: [t.parentFolderId],
      foreignColumns: [t.id],
      name: "board_folders_parent_fkey",
    }).onDelete("cascade"),
  ],
);

export type BoardFolder = typeof boardFolders.$inferSelect;
export type NewBoardFolder = typeof boardFolders.$inferInsert;
