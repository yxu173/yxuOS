CREATE TABLE "team_design_tokens" (
	"team_id" text PRIMARY KEY NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "tokens" jsonb;--> statement-breakpoint
ALTER TABLE "team_design_tokens" ADD CONSTRAINT "team_design_tokens_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;