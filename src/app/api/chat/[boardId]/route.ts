import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStreamResponse } from "ai";

import { safeChatStream } from "@/lib/ai/safe-chat-stream";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";
import type { ProjectToolContext } from "@/mastra/tools/search-knowledge";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;

  let teamId: string;
  let session: Awaited<ReturnType<typeof requireActiveTeam>>["session"];
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
    session = ctx.session;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Confirm the board exists and is owned by the active team.
  // `projectId` is fetched too so the cross-agent search tool can
  // scope every retrieval to the right project. Boards predating
  // the project rollout (projectId null) just don't get a project
  // namespace — the search tool will then refuse with a clear
  // error rather than leaking across projects.
  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true, threadId: true, projectId: true },
  });
  if (!board) {
    return new Response("Not found", { status: 404 });
  }

  const body = await req.json();

  // Attach the `project` namespace when the board has one. Older
  // project-less boards skip it; their agent simply can't call
  // `search_project_knowledge` (and that's the safer default).
  const requestContext = new RequestContext<{
    project: ProjectToolContext;
  }>();
  if (board.projectId) {
    requestContext.set("project", {
      teamId,
      projectId: board.projectId,
    });
  }

  const upstream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "boardArchitect",
    params: {
      ...body,
      requestContext,
      memory: {
        ...(body?.memory ?? {}),
        thread: board.threadId,
        resource: session.user.id,
      },
    },
  });

  // Friendly-error wrap — see `safeChatStream` for the rationale.
  return createUIMessageStreamResponse({ stream: safeChatStream(upstream) });
}
