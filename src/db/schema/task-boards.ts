import {
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
 * A task board is a kanban-style grouping of tasks inside a project —
 * think Linear cycles or sprint boards. Every project gets one auto-
 * created default board ("All tasks"); members can spin up extras for
 * sprints, bug triage, recurring projects, etc.
 *
 * Flat list (not nested like board / design folders) — the strip UI on
 * the tasks index is a single row of pills, not a tree.
 */
export const taskBoards = pgTable(
  "task_boards",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
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
  (t) => [index("task_boards_project_idx").on(t.projectId)],
);

export type TaskBoard = typeof taskBoards.$inferSelect;
export type NewTaskBoard = typeof taskBoards.$inferInsert;
