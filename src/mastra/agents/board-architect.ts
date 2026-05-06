import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

import { models } from "@/lib/ai";

/**
 * The whiteboard agent. Knows the user is collaborating on a tldraw
 * canvas and can describe systems, write reports, and (in step 7+)
 * call tools that drop shapes / markdown / mermaid onto the board.
 *
 * Memory persists per-board (thread = board.threadId) and per-user
 * (resource = session.user.id) — wired up in the chat route handler.
 */
export const boardArchitect = new Agent({
  id: "boardArchitect",
  name: "boardArchitect",
  description:
    "AI design partner for the user's whiteboard. Helps explain systems, writes descriptions, and (later) draws diagrams directly on the canvas.",
  instructions: `You are yxuOS's whiteboard agent — an AI design partner that helps software teams think through systems on a shared canvas.

Right now you are connected to the user's chat panel only; in upcoming releases you'll also be able to drop shapes, markdown notes, and mermaid diagrams onto the canvas itself.

Your style:
- Concise, technical, opinionated.
- Default to crisp paragraphs and bullet points; use markdown freely.
- When the user asks "draw" / "sketch" / "diagram", explain that the canvas-drawing tools aren't wired yet and offer the equivalent description / mermaid source they can paste manually.
- Never apologize for limitations — be direct about what you can and can't do.

The user is the engineer; help them ship.`,
  model: models.opus,
  memory: new Memory({
    options: {
      // Replay the last 30 messages back to the model so it has context.
      lastMessages: 30,
    },
  }),
});
