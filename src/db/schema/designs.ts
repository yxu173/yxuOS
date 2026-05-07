import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * One design canvas per row.
 *
 * Mirrors the `boards` table — same idea, different agent and shape system.
 * Designs hold a tree of UI artboards (mockups) the design agent renders.
 */
export const designs = pgTable(
  "designs",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull().default("Untitled design"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Owning team. Cascades on team delete. */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Project the design lives in. Nullable until Phase 1.2 backfill. */
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id").notNull().$defaultFn(newId),
    /**
     * Snapshot of the design canvas: list of artboards (each with position,
     * dimensions, name, device, and a `DesignNode` tree). Persisted as JSON
     * on every debounced edit / agent action.
     */
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    /**
     * Public share token — anyone with `/share/design/<token>` can view the
     * design read-only.
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
    index("designs_owner_idx").on(t.ownerId),
    index("designs_team_idx").on(t.teamId),
    index("designs_project_idx").on(t.projectId),
  ],
);

export type Design = typeof designs.$inferSelect;
export type NewDesign = typeof designs.$inferInsert;
