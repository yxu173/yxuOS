import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { BoardShell } from "@/components/board/board-shell";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { listUserTeams } from "@/lib/teams";
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

  const { session, teamId } = await requireActiveTeam();

  const [board, userBoards, teams] = await Promise.all([
    db.query.boards.findFirst({
      where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
      columns: {
        id: true,
        name: true,
        snapshot: true,
        threadId: true,
        shareToken: true,
      },
      with: {
        owner: {
          columns: {
            name: true,
            username: true,
            displayUsername: true,
          },
        },
      },
    }),
    db.query.boards.findMany({
      where: eq(boards.teamId, teamId),
      orderBy: desc(boards.updatedAt),
      columns: {
        id: true,
        name: true,
        updatedAt: true,
      },
    }),
    listUserTeams(session.user.id),
  ]);

  if (!board) {
    notFound();
  }

  const initialMessages = await loadInitialMessages(
    board.threadId,
    session.user.id,
  );

  const creator = board.owner
    ? {
        name: board.owner.name,
        username: board.owner.displayUsername ?? board.owner.username,
      }
    : null;

  return (
    <BoardShell
      boardId={board.id}
      boardName={board.name}
      userName={session.user.name}
      userEmail={session.user.email}
      shareToken={board.shareToken}
      initialSnapshot={board.snapshot ?? null}
      boards={userBoards}
      initialMessages={initialMessages}
      teams={teams}
      activeTeamId={teamId}
      creator={creator}
    />
  );
}
