import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";

const newId = () => nanoid();

/**
 * Comment on a board or design — optionally pinned to a specific element
 * inside it (an Excalidraw element id for boards, a DesignNode id for designs).
 *
 * Storage choices:
 * - `subjectType` + `subjectId` is a polymorphic pointer at the surface
 *   level (the board or design the comment lives on). We could split this
 *   into two tables, but the access pattern, permission boundary, and UI
 *   are nearly identical so a single table keeps queries and components
 *   simpler.
 * - `targetId` is null when the comment is on the surface as a whole;
 *   otherwise it's the shape / node id the comment is pinned to.
 * - `mentionedUserIds` snapshots the user ids parsed from the body's
 *   `@username` mentions so unread-count queries don't have to re-parse
 *   the body every time.
 */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "board" | "design" — which surface the comment lives on. */
    subjectType: text("subject_type").notNull(),
    /** Surface id (board id or design id). Lives in board/designs tables. */
    subjectId: text("subject_id").notNull(),
    /**
     * Optional sub-target inside the surface — an Excalidraw element id (boards)
     * or a DesignNode id (designs). Null = comment on the surface itself.
     */
    targetId: text("target_id"),
    body: text("body").notNull(),
    /** Snapshot of the user ids `@mentioned` in the body. */
    mentionedUserIds: jsonb("mentioned_user_ids")
      .$type<string[]>()
      .default([]),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("comments_team_idx").on(t.teamId),
    index("comments_subject_idx").on(t.subjectType, t.subjectId),
    index("comments_author_idx").on(t.authorId),
    index("comments_created_idx").on(t.createdAt),
  ],
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
