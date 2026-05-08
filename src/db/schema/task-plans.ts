import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { projects } from "./projects";
import { researchNotes } from "./research-notes";
import { tasks } from "./tasks";

const newId = () => nanoid();

/**
 * One **task plan** = a structured proposal to break some piece of
 * work into a list of tasks.
 *
 * The Planner agent fills in `task_plan_rows` (one row per proposed
 * task) and the user approves rows individually. Approved rows get
 * materialised into real `tasks` via the bulk-create server action,
 * with `task_plan_rows.created_task_id` linking back so the UI can
 * render "from plan: <plan title>" badges on each generated task.
 *
 * `source_note_id` records the optional handoff: when a research
 * note's "Hand off to planner" button is clicked we create a plan
 * already pointed at the originating note, and the planner agent
 * reads the note's body via the `read_research_note` tool on its
 * first turn.
 */
export const taskPlans = pgTable(
  "task_plans",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Mastra thread id for the plan's chat. Generated once at insert,
     * never rotated — all conversation history stays attached to the
     * plan for its lifetime.
     */
    threadId: text("thread_id").notNull().$defaultFn(newId),
    title: text("title").notNull().default("Untitled plan"),
    /**
     * One of `draft` | `executed` | `archived`. Stays plain text for
     * the same reason research note status does — adding states is a
     * code-only change. `executed` means at least one row has been
     * materialised into a real task.
     */
    status: text("status").notNull().default("draft"),
    /**
     * Optional handoff link — the research note this plan was
     * derived from. Set null on note delete so the plan survives if
     * its source note gets archived/cleaned up.
     */
    sourceNoteId: text("source_note_id").references(() => researchNotes.id, {
      onDelete: "set null",
    }),
    agentMeta: jsonb("agent_meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("task_plans_team_idx").on(t.teamId),
    index("task_plans_project_idx").on(t.projectId),
    index("task_plans_author_idx").on(t.authorId),
    index("task_plans_source_note_idx").on(t.sourceNoteId),
  ],
);

/**
 * One row in a plan = one proposed task. The agent edits these via
 * tools; the user approves them one at a time (`approved_at`) and
 * then bulk-creates real tasks from the approved set.
 *
 * The shape mirrors `tasks` enough that materialising a row is just
 * a `tasks.insert` of the same fields plus team/project/board.
 */
export const taskPlanRows = pgTable(
  "task_plan_rows",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    planId: text("plan_id")
      .notNull()
      .references(() => taskPlans.id, { onDelete: "cascade" }),
    /**
     * Display order within the plan. Plain integer (not a fractional
     * key like `lexorank`) because plans are short — usually 5–20
     * rows — and we always renumber on insert/move.
     */
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * Initial task status the row will be created with. Defaults to
     * `todo`; agent rarely overrides this but the schema allows it
     * for "in_progress" carry-over scenarios.
     */
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("medium"),
    /**
     * Suggested assignee. Validated against team membership in the
     * server action — schema-level we just SET NULL on user delete.
     */
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    dueDate: timestamp("due_date"),
    /**
     * Set when the user ticks the row's checkbox. Bulk-create only
     * materialises rows where this is non-null AND `created_task_id`
     * is null (i.e. approved but not yet executed). Null = pending.
     */
    approvedAt: timestamp("approved_at"),
    /**
     * Filled in by the bulk-create action with the id of the real
     * task this row produced. Once set, the row is "executed" and
     * the UI shows a link to the task instead of the create button.
     * SET NULL on task delete so the row survives if someone trashes
     * the generated task — preserves audit history.
     */
    createdTaskId: text("created_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("task_plan_rows_plan_idx").on(t.planId),
    index("task_plan_rows_plan_position_idx").on(t.planId, t.position),
    index("task_plan_rows_created_task_idx").on(t.createdTaskId),
  ],
);

export type TaskPlan = typeof taskPlans.$inferSelect;
export type NewTaskPlan = typeof taskPlans.$inferInsert;
export type TaskPlanRow = typeof taskPlanRows.$inferSelect;
export type NewTaskPlanRow = typeof taskPlanRows.$inferInsert;
export type TaskPlanStatus = "draft" | "executed" | "archived";
