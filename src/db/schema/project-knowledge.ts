import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { vector } from "./_pgvector";
import { organization } from "./auth";
import { projects } from "./projects";

const newId = () => nanoid();

/**
 * Canonical list of artifact kinds that can be indexed into the
 * project brain. Adding a new kind here is the first step of
 * teaching the brain about a new artifact type:
 *
 *   1. Add the literal to this union.
 *   2. Write a `src/lib/rag/indexers/<kind>.ts` indexer.
 *   3. Wire `index<Kind>` into the write paths for that artifact.
 *   4. Wire `unindex<Kind>` into its delete path.
 *
 * Keep the strings short — they're queried in URLs and shown in
 * UIs as chips ("research", "plan", "task"…).
 */
export type KnowledgeKind =
  | "research_note"
  | "task_plan"
  | "task_plan_row"
  | "task"
  | "board"
  | "design"
  | "design_chat"
  | "comment"
  | "repo_file";

/**
 * Knowledge / RAG store: one row per **chunk** of project content.
 *
 * Every meaningful piece of text the team produces — research notes,
 * plan rows, task descriptions, board text shapes, design chat
 * history, comments — is broken into chunks, embedded, and persisted
 * here. The brain (search + agent tool + Cmd+K semantic mode) reads
 * from this single table, so semantic recall is a one-stop lookup
 * regardless of which artifact the answer actually lives in.
 *
 * Layout decisions:
 *
 * - **Scope is project-bound.** Every row carries `team_id` for
 *   permission checks but the primary filter is `project_id` — we
 *   never want auth bugs to leak knowledge across projects.
 *
 * - **`(source_type, source_id, chunk_index)` is unique.** Chunks
 *   are idempotently upserted; re-indexing the same artifact
 *   updates rows in place rather than inserting duplicates. When
 *   an artifact shrinks, the orphan-cleanup step deletes any
 *   `chunk_index` past the new tail.
 *
 * - **`content_hash` is a cheap dedupe signal.** Before embedding
 *   we compare the new content's SHA-256 against the stored hash
 *   for that chunk slot. If they match, we skip the embed call
 *   entirely — saving the bulk of the cost on unchanged edits.
 *
 * - **`anchor` is the sub-id within the artifact.** For boards this
 *   is the shape id; for plans it's the row id; for design chats
 *   it's the message id; null when the chunk represents the whole
 *   artifact.
 *
 * - **Embedding column is HNSW-indexed** (cosine ops). The index is
 *   added in a manual SQL migration since drizzle-kit doesn't yet
 *   generate pgvector indexes.
 */
export const projectKnowledge = pgTable(
  "project_knowledge",
  {
    id: text("id").primaryKey().$defaultFn(newId),

    /** Owning team. Cascades on team delete. */
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Owning project. Cascades on project delete. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** Which artifact this chunk came from. See `KnowledgeKind`. */
    sourceType: text("source_type").$type<KnowledgeKind>().notNull(),
    /** Artifact id (a `text` nanoid in this codebase). */
    sourceId: text("source_id").notNull(),
    /**
     * 0-based position of this chunk within the artifact's chunked
     * representation. We don't enforce any specific ordering on the
     * source side — the indexer decides what "chunk 0" means
     * (typically: title block, then body chunks in document order).
     */
    chunkIndex: integer("chunk_index").notNull(),

    /**
     * Surfacing helpers for the UI. Stored denormalised so the
     * launcher / brain page can render a useful preview without
     * round-tripping to the artifact's own table.
     */
    title: text("title"),
    /** Sub-id inside the artifact (shape id, plan-row id, …). */
    anchor: text("anchor"),

    /** Plain-text chunk content. The raw payload that was embedded. */
    content: text("content").notNull(),
    /** SHA-256 of `content`. Used to skip re-embedding unchanged chunks. */
    contentHash: text("content_hash").notNull(),
    /** Approximate token count, captured at index time for budgeting. */
    tokens: integer("tokens").notNull(),

    /**
     * Embedding vector. Dimensions match the embedding model
     * (`text-embedding-3-small` = 1536). If we ever switch models
     * with a different dimensionality we'll need a fresh table or
     * an `embed_model` column + per-row index.
     */
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),

    /**
     * Free-form metadata captured at index time. Examples:
     *   - `{ "embedModel": "text-embedding-3-small" }`
     *   - `{ "boardFrame": "<frame name>" }`
     *   - `{ "planRowStatus": "todo" }`
     *
     * Read by the brain UI for filtering / display, never by core
     * retrieval logic — keep that side schema-driven.
     */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Primary filter for every read.
    index("pk_project_idx").on(t.projectId),
    // Convenience filter for kind-narrowed searches and per-artifact
    // re-index passes (delete-by-source).
    index("pk_source_idx").on(t.sourceType, t.sourceId),
    // The dedupe key — also the upsert conflict target.
    uniqueIndex("pk_source_chunk_uq").on(
      t.sourceType,
      t.sourceId,
      t.chunkIndex,
    ),
    // HNSW vector index is created out-of-band in a manual SQL
    // migration (drizzle-kit can't generate `USING hnsw` yet):
    //   CREATE INDEX pk_embedding_hnsw ON project_knowledge
    //   USING hnsw (embedding vector_cosine_ops);
  ],
);

export type ProjectKnowledgeRow = typeof projectKnowledge.$inferSelect;
export type NewProjectKnowledgeRow = typeof projectKnowledge.$inferInsert;
