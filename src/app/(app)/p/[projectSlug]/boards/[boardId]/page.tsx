import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { listCommentsForSubject } from "@/app/(app)/comments/actions";
import { BoardShell } from "@/components/board/board-shell";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { listBoardsForProject } from "@/lib/boards/listing";
import { requireActiveProject } from "@/lib/permissions";
import { listTeamMembers, listUserTeams } from "@/lib/teams";
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
  params: Promise<{ projectSlug: string; boardId: string }>;
}) {
  const { projectSlug, boardId } = await params;

  const { session, teamId, projectId } =
    await requireActiveProject(projectSlug);

  const [board, userBoards, teams, members, commentRows] = await Promise.all([
    // Board itself — NOT cached. The `snapshot` column is mutated on
    // every debounced save during editing; writing it through Redis
    // would burn bandwidth for near-zero hit rate. Read straight from
    // Postgres.
    db.query.boards.findFirst({
      where: and(
        eq(boards.id, boardId),
        eq(boards.teamId, teamId),
        eq(boards.projectId, projectId),
      ),
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
    // Left-panel listing scopes to the same project so the user can
    // jump to siblings without crossing project boundaries. Cached —
    // changes only on create / rename / delete / folder-move.
    listBoardsForProject(teamId, projectId),
    listUserTeams(session.user.id),
    listTeamMembers(teamId),
    listCommentsForSubject("board", boardId),
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
      boardsHrefBase={`/p/${projectSlug}/boards`}
      projectSlug={projectSlug}
      initialMessages={initialMessages}
      initialComments={commentRows}
      members={members.map((m) => ({
        userId: m.userId,
        name: m.name,
        username: m.username,
      }))}
      teams={teams}
      activeTeamId={teamId}
      creator={creator}
    />
  );
}
