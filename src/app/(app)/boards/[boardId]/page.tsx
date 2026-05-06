import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { BoardShell } from "@/components/board/board-shell";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";
import { mastra } from "@/mastra";

async function loadInitialMessages(
  threadId: string,
  resourceId: string,
): Promise<UIMessage[]> {
  try {
    const memory = await mastra.getAgentById("boardArchitect").getMemory();
    if (!memory) return [];

    const result = await memory.recall({ threadId, resourceId });
    return toAISdkMessages(result.messages, { version: "v6" });
  } catch {
    // First chat on a fresh board — no thread exists yet.
    return [];
  }
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const [board, userBoards] = await Promise.all([
    db.query.boards.findFirst({
      where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
      columns: {
        id: true,
        name: true,
        snapshot: true,
        threadId: true,
      },
    }),
    db.query.boards.findMany({
      where: eq(boards.ownerId, session.user.id),
      orderBy: desc(boards.updatedAt),
      columns: {
        id: true,
        name: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!board) {
    notFound();
  }

  const initialMessages = await loadInitialMessages(
    board.threadId,
    session.user.id,
  );

  return (
    <BoardShell
      boardId={board.id}
      boardName={board.name}
      userName={session.user.name}
      userEmail={session.user.email}
      initialSnapshot={board.snapshot ?? null}
      boards={userBoards}
      initialMessages={initialMessages}
    />
  );
}
