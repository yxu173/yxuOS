CREATE TABLE "design_components" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tree" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "design_components_owner_slug_unique" UNIQUE("owner_id","slug")
);
--> statement-breakpoint
ALTER TABLE "design_components" ADD CONSTRAINT "design_components_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_components_owner_idx" ON "design_components" USING btree ("owner_id");