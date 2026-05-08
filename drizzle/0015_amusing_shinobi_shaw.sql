CREATE TABLE "research_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"author_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"title" text DEFAULT 'Untitled research' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"agent_meta" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_notes_team_idx" ON "research_notes" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "research_notes_project_idx" ON "research_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_notes_author_idx" ON "research_notes" USING btree ("author_id");