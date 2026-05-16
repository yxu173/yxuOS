-- pgvector extension. Neon ships this preinstalled but the
-- `CREATE EXTENSION` is idempotent and lets the migration run on a
-- fresh dev DB without manual setup.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "project_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"title" text,
	"anchor" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"tokens" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_knowledge" ADD CONSTRAINT "project_knowledge_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge" ADD CONSTRAINT "project_knowledge_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pk_project_idx" ON "project_knowledge" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pk_source_idx" ON "project_knowledge" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pk_source_chunk_uq" ON "project_knowledge" USING btree ("source_type","source_id","chunk_index");--> statement-breakpoint
-- HNSW index for fast cosine-similarity search. Defaults
-- (m=16, ef_construction=64) match what Neon's docs recommend
-- for collections in the 10k–1M row range, which covers any
-- reasonable project. We use `vector_cosine_ops` because the
-- embedding model (`text-embedding-3-small`) is L2-normalised
-- and cosine is the standard similarity for sentence embeddings.
CREATE INDEX "pk_embedding_hnsw" ON "project_knowledge" USING hnsw ("embedding" vector_cosine_ops);