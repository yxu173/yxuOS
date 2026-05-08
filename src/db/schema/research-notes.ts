import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { organization, user } from "./auth";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * One **research note** = one durable artifact produced by the
 * Researcher agent.
 *
 * Each note is co-authored: the user opens a note with a question,
 * the agent fills in `body` (Markdown) with findings + citations, and
 * either party can keep editing. The accompanying agent conversation
 * lives in Mastra's own `mastra.messages` table, addressed by
 * `threadId` (one thread per note, never reused).
 *
 * Scope: project-bound. A note belongs to exactly one project; cross-
 * project research uses a fresh note inside the relevant project. This
 * keeps memory + permissions naturally compartmentalised.
 */
export const researchNotes = pgTable(
  "research_notes",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    /** Owning team. Cascades on team delete. */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Owning project. A note always lives inside one project. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The human who initiated the note. Cascades on user delete. */
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Mastra thread id used as the agent memory thread for this note.
     * Generated once at insert and never rotated, so the conversation
     * history stays tied to the note for its whole lifetime.
     */
    threadId: text("thread_id").notNull().$defaultFn(newId),
    /**
     * Title shown in lists. Agent can suggest one via the
     * `update_research_note` tool; the user is free to overwrite it.
     * Defaulted on insert so a brand-new empty note still renders a
     * label in the index.
     */
    title: text("title").notNull().default("Untitled research"),
    /**
     * Markdown body of the note. Stored as plain text (not TipTap
     * JSON) because the agent writes / patches it most naturally as
     * Markdown, and the index page can render it via `ChatMarkdown`
     * with no extra parsing layer.
     */
    body: text("body").notNull().default(""),
    /**
     * One of `draft` | `reviewed` | `archived`. Stored as text (not
     * a Postgres enum) so adding states later is just a code change,
     * no migration. Defaults to `draft` until the user explicitly
     * promotes the note.
     */
    status: text("status").notNull().default("draft"),
    /**
     * Free-form metadata blob: model used, exa queries fired,
     * citation list, token counts. Keeping it as `jsonb` means we
     * can layer richer analytics on top later without schema
     * migrations. Nullable because the very first save (before any
     * agent turn) has nothing to record.
     */
    agentMeta: jsonb("agent_meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("research_notes_team_idx").on(t.teamId),
    index("research_notes_project_idx").on(t.projectId),
    index("research_notes_author_idx").on(t.authorId),
  ],
);

export type ResearchNote = typeof researchNotes.$inferSelect;
export type NewResearchNote = typeof researchNotes.$inferInsert;
export type ResearchNoteStatus = "draft" | "reviewed" | "archived";
