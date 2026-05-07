ALTER TABLE "boards" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "design_assets" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "design_components" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "designs" ALTER COLUMN "team_id" SET NOT NULL;