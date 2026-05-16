CREATE TABLE "project_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"last_indexed_sha" text,
	"access_token" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"total_files" integer DEFAULT 0 NOT NULL,
	"indexed_files" integer DEFAULT 0 NOT NULL,
	"skipped_files" integer DEFAULT 0 NOT NULL,
	"imported_by_id" text NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_imported_by_id_user_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repos_unique_idx" ON "project_repos" USING btree ("project_id","owner","repo","branch");--> statement-breakpoint
CREATE INDEX "project_repos_project_idx" ON "project_repos" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_repos_status_idx" ON "project_repos" USING btree ("status");