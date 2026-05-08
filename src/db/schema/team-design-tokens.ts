import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";

/**
 * Team-level default design tokens.
 *
 * One row per team. The agent / user can read these via `list_tokens`
 * and write them via `set_tokens(scope: "team", …)`. Per-design tokens
 * (`designs.tokens` jsonb column) override these on a per-key basis at
 * resolution time.
 *
 * The `tokens` blob is a flat `Record<string, string | number>` keyed
 * on a dotted path (`color.accent`, `font.family`, `radius.md`,
 * `spacing.section`, …). Free-form within those prefix categories so
 * the agent can introduce new tokens without a schema change.
 */
export const teamDesignTokens = pgTable("team_design_tokens", {
  /** PK = teamId so each team has at most one row. */
  teamId: text("team_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  tokens: jsonb("tokens")
    .$type<Record<string, string | number>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type TeamDesignTokens = typeof teamDesignTokens.$inferSelect;
export type NewTeamDesignTokens = typeof teamDesignTokens.$inferInsert;
