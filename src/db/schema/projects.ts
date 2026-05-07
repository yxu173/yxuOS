import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization } from "./auth";

const newId = () => nanoid();

/**
 * A project is a workspace inside a team — boards, designs, tasks,
 * components and assets all live under one. Every team gets a default
 * project at sign-up time (`Workspace`); members can spin up extra ones
 * to keep work-streams separated.
 *
 * - `(team_id, slug)` is unique so URLs stay stable: `/p/<slug>/boards`.
 * - `archived` + `archived_at` lets us hide a project without deleting
 *   the data; the UI filters archived projects out of the switcher by
 *   default.
 * - Permission boundary stays at the team level: anyone on the team can
 *   read/write any of its projects. Project-level ACLs is a future
 *   feature.
 */
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** URL-safe slug, unique per team. */
    slug: text("slug").notNull(),
    /** Optional accent colour for the switcher / header tinting (hex). */
    color: text("color"),
    /** True once an owner archives the project. We don't hard-delete by default. */
    archived: boolean("archived").notNull().default(false),
    /** Set when `archived` flips to true; cleared when un-archived. */
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("projects_team_idx").on(t.teamId),
    uniqueIndex("projects_team_slug_uidx").on(t.teamId, t.slug),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
