import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";

import { env } from "@/lib/env";

import { boardArchitect } from "./agents/board-architect";
import { designArchitect } from "./agents/design-architect";
import { planner } from "./agents/planner";
import { researcher } from "./agents/researcher";
import { scorers } from "./scorers";
import { workspace } from "./workspace";

/**
 * Single Mastra instance shared by every server component / route handler.
 *
 * Storage now lives in Neon Postgres (same database as the rest of the app).
 * Mastra creates its own tables (threads, messages, resources, …) in the
 * `mastra` schema so they don't collide with our Drizzle-managed schema in
 * `public`.
 *
 * Scorers are registered globally so any agent can opt-in via its
 * `scorers` field; the agent-level entry attaches sampling rates so the
 * `scores` table doesn't grow unbounded.
 *
 * Workspace provides filesystem access and skill discovery. Skills are
 * loaded from `skills/` and `.agent-skills/` directories and made available
 * to agents via the `skill`, `skill_read`, and `skill_search` tools.
 */
export const mastra = new Mastra({
  storage: new PostgresStore({
    id: "yxuos-mastra",
    connectionString: env.DATABASE_URL,
    schemaName: "mastra",
  }),
  agents: { boardArchitect, designArchitect, researcher, planner },
  scorers,
  workspace,
});
