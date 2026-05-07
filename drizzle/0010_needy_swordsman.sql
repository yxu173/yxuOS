CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "design_assets" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "design_components" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_slug_uidx" ON "projects" USING btree ("team_id","slug");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_components" ADD CONSTRAINT "design_components_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "boards_project_idx" ON "boards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "design_assets_project_idx" ON "design_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "design_components_project_idx" ON "design_components" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "designs_project_idx" ON "designs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");