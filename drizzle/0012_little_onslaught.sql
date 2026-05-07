CREATE TABLE "design_folders" (
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
ALTER TABLE "designs" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "design_folders" ADD CONSTRAINT "design_folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_folders" ADD CONSTRAINT "design_folders_parent_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."design_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_folders_project_idx" ON "design_folders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "design_folders_parent_idx" ON "design_folders" USING btree ("parent_folder_id");--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_folder_id_design_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."design_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "designs_folder_idx" ON "designs" USING btree ("folder_id");