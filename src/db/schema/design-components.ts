import { index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";

const newId = () => nanoid();

/**
 * Reusable design components per user.
 *
 * The agent gets a list of available components via the `list_components`
 * tool and can reference them in design trees as
 *   { type: "component-ref", componentSlug: "stride-logo" }
 *
 * The renderer expands references at render time. Edit a component once →
 * every design that uses it picks up the change on next render.
 */
export const designComponents = pgTable(
  "design_components",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Owning team. Cascades on team delete. */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Human-readable name shown in the library, e.g. "Stride Logo". */
    name: text("name").notNull(),
    /** Stable kebab-case identifier the agent / DesignNodes reference. */
    slug: text("slug").notNull(),
    /** The DesignNode tree this component expands to. */
    tree: jsonb("tree").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("design_components_owner_idx").on(t.ownerId),
    index("design_components_team_idx").on(t.teamId),
    // Slugs unique per-user so two users can both have a "logo" component.
    unique("design_components_owner_slug_unique").on(t.ownerId, t.slug),
  ],
);

export type DesignComponent = typeof designComponents.$inferSelect;
export type NewDesignComponent = typeof designComponents.$inferInsert;
