CREATE TABLE "designs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Untitled design' NOT NULL,
	"owner_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"snapshot" jsonb,
	"share_token" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "designs_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "designs_owner_idx" ON "designs" USING btree ("owner_id");