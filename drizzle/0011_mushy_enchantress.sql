CREATE TABLE "board_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_folder_id" text,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "board_folders" ADD CONSTRAINT "board_folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_folders" ADD CONSTRAINT "board_folders_parent_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."board_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_folders_project_idx" ON "board_folders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "board_folders_parent_idx" ON "board_folders" USING btree ("parent_folder_id");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_folder_id_board_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."board_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_folder_idx" ON "boards" USING btree ("folder_id");