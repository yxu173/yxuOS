import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReadonlyWhiteboard } from "@/components/board/readonly-whiteboard";
import { db } from "@/db";
import { boards } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function SharedBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const board = await db.query.boards.findFirst({
    where: eq(boards.shareToken, token),
    columns: {
      id: true,
      name: true,
      snapshot: true,
    },
  });

  if (!board) {
    notFound();
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/60 px-3 backdrop-blur">
        <Link
          href="/"
          className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
        >
          yxuOS
        </Link>
        <span className="text-zinc-600">/</span>
        <span className="truncate text-sm font-medium text-zinc-100">
          {board.name}
        </span>
        <span className="ml-2 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          read-only
        </span>
      </header>
      <main className="relative flex-1 overflow-hidden">
        <ReadonlyWhiteboard snapshot={board.snapshot ?? null} />
      </main>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await db.query.boards.findFirst({
    where: eq(boards.shareToken, token),
    columns: { name: true },
  });
  return {
    title: board ? `${board.name} · yxuOS` : "Shared board · yxuOS",
  };
}
