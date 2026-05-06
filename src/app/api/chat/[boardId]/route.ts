import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";
import { mastra } from "@/mastra";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Confirm the board exists and belongs to this user — never leak that a
  // foreign id exists.
  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
    columns: { id: true, threadId: true },
  });
  if (!board) {
    return new Response("Not found", { status: 404 });
  }

  const body = await req.json();

  const stream = await handleChatStream({
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

  return createUIMessageStreamResponse({ stream });
}
