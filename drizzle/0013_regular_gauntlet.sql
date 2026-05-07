CREATE TABLE "task_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "task_board_id" text;--> statement-breakpoint
ALTER TABLE "task_boards" ADD CONSTRAINT "task_boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_boards_project_idx" ON "task_boards" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_board_id_task_boards_id_fk" FOREIGN KEY ("task_board_id") REFERENCES "public"."task_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_task_board_idx" ON "tasks" USING btree ("task_board_id");