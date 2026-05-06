import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";

import { env } from "@/lib/env";

import { boardArchitect } from "./agents/board-architect";
import { designArchitect } from "./agents/design-architect";

/**
 * Single Mastra instance shared by every server component / route handler.
 *
 * Storage now lives in Neon Postgres (same database as the rest of the app).
 * Mastra creates its own tables (threads, messages, resources, …) in the
 * `mastra` schema so they don't collide with our Drizzle-managed schema in
 * `public`.
 */
export const mastra = new Mastra({
  storage: new PostgresStore({
    id: "yxuos-mastra",
    connectionString: env.DATABASE_URL,
    schemaName: "mastra",
  }),
  agents: { boardArchitect, designArchitect },
});
