CREATE TABLE "task_plan_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_id" text,
	"due_date" timestamp,
	"approved_at" timestamp,
	"created_task_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"author_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"title" text DEFAULT 'Untitled plan' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_note_id" text,
	"agent_meta" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_plan_rows" ADD CONSTRAINT "task_plan_rows_plan_id_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."task_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plan_rows" ADD CONSTRAINT "task_plan_rows_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plan_rows" ADD CONSTRAINT "task_plan_rows_created_task_id_tasks_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_source_note_id_research_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."research_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_plan_rows_plan_idx" ON "task_plan_rows" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "task_plan_rows_plan_position_idx" ON "task_plan_rows" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "task_plan_rows_created_task_idx" ON "task_plan_rows" USING btree ("created_task_id");--> statement-breakpoint
CREATE INDEX "task_plans_team_idx" ON "task_plans" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "task_plans_project_idx" ON "task_plans" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_plans_author_idx" ON "task_plans" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "task_plans_source_note_idx" ON "task_plans" USING btree ("source_note_id");