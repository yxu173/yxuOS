-- Phase 4 of the tldraw → Excalidraw migration: decommission tldraw.
--
-- 1. Wipe every board's snapshot. The user opted into "no backfill",
--    so we don't try to convert anything; the next time someone opens
--    a board it'll mount Excalidraw with an empty scene. This is
--    irreversible — back up `boards.snapshot` before applying if you
--    care about the existing data.
-- 2. Drop the per-board `engine` column we introduced in the (now
--    rolled-back) Phase 3 migration. From here on every board is
--    rendered by Excalidraw, full stop.
--
-- `DROP COLUMN IF EXISTS` so this is idempotent against fresh
-- environments that never applied the original 0018 column-add.

UPDATE "boards" SET "snapshot" = NULL;
ALTER TABLE "boards" DROP COLUMN IF EXISTS "engine";
