import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { BoardsGrid } from "@/components/boards/boards-grid";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";

import { createBoard } from "./actions";

export default async function BoardsIndexPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const userBoards = await db.query.boards.findMany({
    where: eq(boards.ownerId, session.user.id),
    columns: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {session.user.name}.
          </p>
        </div>
        <form action={createBoard}>
          <Button type="submit">New board</Button>
        </form>
      </header>

      <BoardsGrid boards={userBoards} />
    </main>
  );
}
