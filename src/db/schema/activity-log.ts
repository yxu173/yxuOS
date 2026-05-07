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
 * Append-only activity feed for a team.
 *
 * Every meaningful mutation (create / update / delete a board, design,
 * member, comment) writes a row here. The feed is rendered on the home
 * dashboard ("Recent activity") and on the team page.
 *
 * `subjectName` is a snapshot of the subject's name AT THE TIME — we keep
 * it so the feed stays readable after the underlying board / design is
 * deleted.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Past-tense verb describing what happened — `created`, `updated`,
     * `deleted`, `commented`, `added_member`, `removed_member`,
     * `renamed`. Free text so we can extend without migrations.
     */
    verb: text("verb").notNull(),
    /** What kind of thing — `board`, `design`, `comment`, `member`, `team`. */
    subjectType: text("subject_type").notNull(),
    /** Id of the subject (board id, design id, comment id, user id, team id). */
    subjectId: text("subject_id").notNull(),
    /** Snapshot of the subject's name at write time, so the feed survives deletes. */
    subjectName: text("subject_name"),
    /** Free-form context (e.g. mentioned user ids on a comment). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    // Primary access pattern: feed for a team, newest first.
    index("activity_log_team_created_idx").on(t.teamId, t.createdAt),
    index("activity_log_actor_idx").on(t.actorId),
  ],
);

export type ActivityRow = typeof activityLog.$inferSelect;
export type NewActivityRow = typeof activityLog.$inferInsert;
