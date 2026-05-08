import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { designFolders } from "./design-folders";
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
    /** Folder inside the project. Null = project root. */
    folderId: text("folder_id").references(() => designFolders.id, {
      onDelete: "set null",
    }),
    threadId: text("thread_id").notNull().$defaultFn(newId),
    /**
     * Snapshot of the design canvas: list of artboards (each with position,
     * dimensions, name, device, and a `DesignNode` tree). Persisted as JSON
     * on every debounced edit / agent action.
     */
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    /**
     * Per-design design tokens — flat `Record<dotted-path, string|number>`
     * (e.g. `{ "color.accent": "#10b981", "radius.md": 12 }`). Overrides
     * the team-default tokens row on a per-key basis. Resolved by the
     * renderer wherever a style value is `"{token.path}"`.
     *
     * Nullable because most existing designs don't have any custom
     * tokens; null is treated as `{}` (use team defaults / let literals
     * pass through).
     */
    tokens: jsonb("tokens").$type<Record<string, string | number> | null>(),
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
    index("designs_folder_idx").on(t.folderId),
  ],
);

export type Design = typeof designs.$inferSelect;
export type NewDesign = typeof designs.$inferInsert;
