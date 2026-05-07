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
 * Folder for organising designs inside a project. Mirrors `board_folders`
 * — same nesting + cascade semantics, separate table because designs and
 * boards each have their own organisational hierarchy that the UI shows
 * independently.
 */
export const designFolders = pgTable(
  "design_folders",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentFolderId: text("parent_folder_id"),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("design_folders_project_idx").on(t.projectId),
    index("design_folders_parent_idx").on(t.parentFolderId),
    foreignKey({
      columns: [t.parentFolderId],
      foreignColumns: [t.id],
      name: "design_folders_parent_fkey",
    }).onDelete("cascade"),
  ],
);

export type DesignFolder = typeof designFolders.$inferSelect;
export type NewDesignFolder = typeof designFolders.$inferInsert;
