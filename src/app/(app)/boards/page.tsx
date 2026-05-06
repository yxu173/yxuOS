import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { auth } from "@/lib/auth";

import { createBoard } from "./actions";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function BoardsIndexPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const userBoards = await db.query.boards.findMany({
    where: eq(boards.ownerId, session.user.id),
    orderBy: desc(boards.updatedAt),
    columns: {
      id: true,
      name: true,
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

      {userBoards.length === 0 ? (
        <section className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>No boards yet.</p>
          <p className="text-xs">Hit “New board” to start whiteboarding.</p>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userBoards.map((board) => (
            <li key={board.id}>
              <Link
                href={`/boards/${board.id}`}
                className="group block focus-visible:outline-none"
              >
                <Card className="h-32 transition-colors group-hover:border-foreground/30 group-focus-visible:border-foreground/40">
                  <CardHeader>
                    <CardTitle className="truncate text-base">
                      {board.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Updated {dateFormatter.format(board.updatedAt)}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
