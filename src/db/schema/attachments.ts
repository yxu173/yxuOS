import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";

const newId = () => nanoid();

/**
 * Generic team-scoped uploads — images dropped into a markdown editor,
 * referenced from anywhere via their public URL.
 *
 * Distinct from `design_assets`: those are first-class library entries
 * the design agent enumerates, deliberately curated by the user.
 * Attachments are cheap inline uploads — paste a screenshot into a task
 * description and we record the metadata so we can list / clean up later
 * without scraping markdown bodies.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Original file name. */
    name: text("name").notNull(),
    /** Vercel Blob pathname — needed for `del()`. */
    pathname: text("pathname").notNull(),
    /** Public CDN URL referenced from markdown. */
    url: text("url").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("attachments_team_idx").on(t.teamId),
    index("attachments_uploader_idx").on(t.uploaderId),
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
