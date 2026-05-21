ALTER TABLE "boards" ADD COLUMN "locked_by_id" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_locked_by_id_user_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;