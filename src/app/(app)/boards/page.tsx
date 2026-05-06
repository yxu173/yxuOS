import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";

async function createBoard() {
  "use server";
  // Step 3 will replace this with a real DB insert. For now we just mint
  // an id and let the canvas page handle it via local persistence.
  const id = nanoid();
  redirect(`/boards/${id}`);
}

export default async function BoardsIndexPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {session?.user.name ?? "there"}.
          </p>
        </div>
        <form action={createBoard}>
          <Button type="submit">New board</Button>
        </form>
      </header>

      <section className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        <p>No boards yet.</p>
        <p className="text-xs">
          The list lands in step 5 once boards persist to the database.
        </p>
      </section>
    </main>
  );
}
