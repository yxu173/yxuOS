import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";
import * as schema from "./schema";

const sql = neon(env.DATABASE_URL);

/**
 * Drizzle client backed by Neon's HTTP driver.
 *
 * Use this everywhere we need to query the database. For session/transactional
 * use cases, swap to `drizzle-orm/neon-serverless` (WebSockets) — the rest of
 * the codebase shouldn't have to change.
 */
export const db = drizzle({ client: sql, schema, casing: "snake_case" });

export type DB = typeof db;
export { schema };
