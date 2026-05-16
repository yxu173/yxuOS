import { customType } from "drizzle-orm/pg-core";

/**
 * `vector(n)` column type for pgvector.
 *
 * Drizzle doesn't ship a first-class pgvector type — pgvector itself
 * is a Postgres extension (`CREATE EXTENSION vector`) so its column
 * type lives outside the standard SQL surface. We define a thin
 * `customType` wrapper so Drizzle treats the column as a real
 * `number[]` at the application boundary while serialising to / from
 * pgvector's bracketed text representation at the driver boundary.
 *
 * Format on the wire: `'[0.123,-0.456,...]'` — pgvector accepts this
 * literal in `INSERT`/`UPDATE` and emits the same shape on `SELECT`.
 * Both `@neondatabase/serverless` drivers (HTTP and WS) hand us the
 * raw text, so `fromDriver` parses it back into JS numbers.
 *
 * Why not store as `float4[]`? Two reasons: pgvector indexes (HNSW,
 * IVFFlat) require the dedicated `vector` type, and the operator
 * suite (`<=>` cosine, `<#>` inner product, `<->` L2) is only
 * defined on `vector`.
 *
 * Usage:
 *
 *   import { vector } from "./_pgvector";
 *   embedding: vector("embedding", { dimensions: 1536 }).notNull(),
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    if (!config) {
      throw new Error(
        "`vector` column requires a `dimensions` config (e.g. vector('embedding', { dimensions: 1536 }))",
      );
    }
    return `vector(${config.dimensions})`;
  },
  toDriver(value: number[]): string {
    // pgvector's text format: `[1,2,3]` — no spaces required, but
    // we don't add any so the wire payload stays compact for big
    // batched inserts.
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // Strip the outer brackets and split. `JSON.parse` would also
    // work but allocates an intermediate string; for 1536-dim
    // vectors the manual path is measurably cheaper.
    if (value.length < 2) return [];
    const inner = value.slice(1, -1);
    if (inner.length === 0) return [];
    return inner.split(",").map(Number);
  },
});
