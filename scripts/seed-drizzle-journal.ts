import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { db } from "@/db";

/**
 * Drizzle-kit tracks applied migrations in `drizzle.__drizzle_migrations`
 * with one row per migration. The hash is sha256 over the raw SQL file.
 * This DB's journal is empty (the schema was applied another way),
 * which causes `drizzle-kit migrate` to try every migration from
 * scratch and conflict. Mark every existing migration as applied so
 * future ones land cleanly.
 */
async function main() {
  const dir = "drizzle";
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, "utf-8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };

  for (const file of files) {
    const tag = file.replace(/\.sql$/, "");
    const entry = journal.entries.find((e) => e.tag === tag);
    if (!entry) {
      console.error("no journal entry for", tag);
      continue;
    }
    const sqlContent = readFileSync(`${dir}/${file}`, "utf-8");
    const hash = createHash("sha256").update(sqlContent).digest("hex");

    const existing = await db.execute(
      sql`SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`,
    );
    if ((existing as { rows: unknown[] }).rows.length > 0) {
      console.log("skip (already in journal):", tag);
      continue;
    }
    await db.execute(
      sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${entry.when})`,
    );
    console.log("inserted journal entry:", tag);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
