import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";

import { safeChatStream } from "@/lib/ai/safe-chat-stream";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";

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
  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true, threadId: true },
  });
  if (!board) {
    return new Response("Not found", { status: 404 });
  }

  const body = await req.json();

  const upstream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "boardArchitect",
    params: {
      ...body,
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
