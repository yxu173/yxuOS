import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStreamResponse } from "ai";

import { safeChatStream } from "@/lib/ai/safe-chat-stream";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { researchNotes } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";
import type { ResearchToolContext } from "@/mastra/tools/research-workspace";

/**
 * Streaming chat endpoint for the Researcher agent.
 *
 * Mirrors `/api/design-chat/[designId]/route.ts` in shape:
 *   1. Resolve the active session + team.
 *   2. Verify the note belongs to the team (defense in depth).
 *   3. Build a Mastra `RequestContext` carrying the note scope so
 *      every tool invocation knows which team / project / note it's
 *      operating on. Tools NEVER trust input ids alone.
 *   4. Hand off to `handleChatStream`, threading memory by the
 *      note's `threadId` and resourcing by the project id (so
 *      working memory is shared across every note in the project,
 *      matching the per-project memory decision).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { noteId } = await params;

  let teamId: string;
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const note = await db.query.researchNotes.findFirst({
    where: and(
      eq(researchNotes.id, noteId),
      eq(researchNotes.teamId, teamId),
    ),
    columns: {
      id: true,
      threadId: true,
      projectId: true,
    },
  });
  if (!note) {
    return new Response("Not found", { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await req.json()) as any;

  // Build a RequestContext carrying the per-turn note scope. Every
  // research tool reads this — the agent literally cannot read
  // another project's data because the tools execute against the
  // server-known projectId, not anything the model emits.
  const requestContext = new RequestContext<{
    research: ResearchToolContext;
  }>();
  requestContext.set("research", {
    teamId,
    projectId: note.projectId,
    noteId: note.id,
  });

  const upstream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "researcher",
    params: {
      ...body,
      requestContext,
      memory: {
        ...(body?.memory ?? {}),
        // One thread per note → conversation history is private to
        // this note and survives reloads.
        thread: note.threadId,
        // Resource = project id → working memory ("we use Drizzle,
        // accent is indigo, …") is shared across every note in the
        // project but never leaks across projects. This is the
        // "memory scoped per-project" decision wired up.
        resource: note.projectId,
      },
    },
  });

  // Friendly-error wrap — see `safeChatStream` for the rationale.
  return createUIMessageStreamResponse({ stream: safeChatStream(upstream) });
}
