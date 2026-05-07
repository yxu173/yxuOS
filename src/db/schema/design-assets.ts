import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * Per-user image library. Files live on Vercel Blob; we keep the metadata
 * in Postgres so we can list / scope / cascade-delete on user removal.
 *
 * Designs reference assets by their public Blob URL inside `image` nodes
 * (`{ type: "image", src: "<asset.url>" }`). The agent learns about
 * available assets via the `list_assets` tool.
 */
export const designAssets = pgTable(
  "design_assets",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Owning team. Cascades on team delete. */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Project the asset lives in. Nullable until Phase 1.2 backfill. */
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    /** Display name (defaults to the original file name). */
    name: text("name").notNull(),
    /** Vercel Blob pathname — needed for `del()`. */
    pathname: text("pathname").notNull(),
    /** Public CDN URL the renderer / agent uses. */
    url: text("url").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("design_assets_owner_idx").on(t.ownerId),
    index("design_assets_team_idx").on(t.teamId),
    index("design_assets_project_idx").on(t.projectId),
  ],
);

export type DesignAsset = typeof designAssets.$inferSelect;
