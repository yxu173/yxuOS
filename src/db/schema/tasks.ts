import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";

const newId = () => nanoid();

/**
 * Linear-style tasks.
 *
 * - `team_id` scopes tasks to a team — creator and assignee must both be
 *   team members (enforced in server actions, not the schema).
 * - `parent_task_id` is a self-reference for subtasks. Cascades on parent
 *   delete so subtasks vanish with their parent. The FK is declared in
 *   the constraints array because Drizzle can't reference a table that
 *   isn't defined yet from within the column declaration.
 * - `status`, `priority` are kept as `text` (not `pgEnum`) to keep schema
 *   migrations cheap when we want to add a new value later. The valid
 *   values are documented in `task-types.ts` and validated in actions.
 * - `completed_at` is set when status flips to `done` and cleared on
 *   any other status change. Useful for cycle / throughput reporting later.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null = unassigned. Set null on user delete so the task survives. */
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Parent task — null for top-level tasks. */
    parentTaskId: text("parent_task_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("medium"),
    dueDate: timestamp("due_date"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("tasks_team_idx").on(t.teamId),
    index("tasks_team_status_idx").on(t.teamId, t.status),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_creator_idx").on(t.creatorId),
    foreignKey({
      columns: [t.parentTaskId],
      foreignColumns: [t.id],
      name: "tasks_parent_task_id_fkey",
    }).onDelete("cascade"),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
