import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { Whiteboard } from "@/components/board/whiteboard";
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

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
    columns: {
      id: true,
      snapshot: true,
    },
  });

  if (!board) {
    notFound();
  }

  return (
    <Whiteboard
      boardId={board.id}
      initialSnapshot={board.snapshot ?? null}
    />
  );
}
