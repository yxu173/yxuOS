import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";

import { boardArchitect } from "./agents/board-architect";

/**
 * Single Mastra instance shared by every server component / route handler.
 *
 * Storage is the local LibSQL file `mastra.db` at the project root —
 * matches the choice the user made in step 0. Swap to `@mastra/pg` and
 * point at `DATABASE_URL` once we want chat memory living in Neon
 * alongside the rest of the app data.
 */
export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "yxuos-mastra",
    url: "file:./mastra.db",
  }),
  agents: { boardArchitect },
});
