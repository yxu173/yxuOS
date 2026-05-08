import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "@/lib/env";

import * as schema from "./schema";

/**
 * WebSocket-backed Drizzle client for **transactional** code paths.
 *
 * The default `db` export in `./index.ts` uses Neon's HTTP driver, which
 * is faster for one-shot queries but can't run interactive transactions
 * (`db.transaction(...)` throws "No transactions support in neon-http
 * driver"). For multi-statement work that has to roll back atomically
 * — e.g. plan execution materialising rows + flipping plan status — we
 * need the WebSocket driver, which speaks Postgres natively and
 * supports real `BEGIN`/`COMMIT`.
 *
 * Two clients side-by-side keeps the cost honest: every page load
 * still hits HTTP (cheap, edge-friendly), and only the rare
 * transactional action pays the WS-handshake tax.
 *
 * Usage:
 *
 *     import { dbTx } from "@/db/tx";
 *     await dbTx.transaction(async (tx) => { ... });
 *
 * The `schema` shape is identical to `db`, so query types match and
 * you can swap clients without touching call sites.
 */

// Node 20+ ships a global `WebSocket`, but `@neondatabase/serverless`
// expects the older `ws` package's class on Node. Setting this once
// here is a no-op in environments that already polyfill it.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const dbTx = drizzle({ client: pool, schema, casing: "snake_case" });
