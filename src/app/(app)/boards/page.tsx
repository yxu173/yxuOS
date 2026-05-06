import { headers } from "next/headers";

import { auth } from "@/lib/auth";

export default async function BoardsIndexPage() {
  // The (app) layout already gated the session, but we re-fetch here for the
  // user's name. Next.js dedupes within the same request.
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
      </header>

      <section className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Board list lands in step 5. The whiteboard itself comes in step 2.
      </section>
    </main>
  );
}
