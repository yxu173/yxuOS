import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { BoardShell } from "@/components/board/board-shell";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";

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

  return (
    <BoardShell
      boardId={board.id}
      boardName={board.name}
      userName={session.user.name}
      initialSnapshot={board.snapshot ?? null}
      boards={userBoards}
    />
  );
}
