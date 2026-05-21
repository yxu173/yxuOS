CREATE TABLE "board_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"edited_by_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_versions" ADD CONSTRAINT "board_versions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_versions" ADD CONSTRAINT "board_versions_edited_by_id_user_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_versions_board_created_idx" ON "board_versions" USING btree ("board_id","created_at");