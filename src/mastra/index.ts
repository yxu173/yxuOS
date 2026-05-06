import { Mastra } from "@mastra/core/mastra";

import { boardArchitect } from "./agents/board-architect";

export const mastra = new Mastra({
  agents: { boardArchitect },
});
