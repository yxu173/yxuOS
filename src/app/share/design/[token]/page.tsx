import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DesignRenderer } from "@/components/design/design-renderer";
import type { Artboard } from "@/components/design/types";
import { db } from "@/db";
import { designs } from "@/db/schema";

export const dynamic = "force-dynamic";

interface DesignSnapshot {
  artboards?: Artboard[];
}

export default async function SharedDesignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const design = await db.query.designs.findFirst({
    where: eq(designs.shareToken, token),
    columns: {
      id: true,
      name: true,
      snapshot: true,
    },
  });

  if (!design) {
    notFound();
  }

  const snapshot = (design.snapshot as DesignSnapshot | null) ?? null;
  const artboards = snapshot?.artboards ?? [];

  // Render artboards stacked vertically with their device labels — no
  // pan/zoom/edit, just the actual designs at full size for read-only
  // viewing.
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-white/5 bg-zinc-950/80 px-3 backdrop-blur">
        <Link
          href="/"
          className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
        >
          yxuOS
        </Link>
        <span className="text-zinc-600">/</span>
        <span className="truncate text-sm font-medium text-zinc-100">
          {design.name}
        </span>
        <span className="ml-2 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          read-only
        </span>
      </header>

      {artboards.length === 0 ? (
        <main className="grid min-h-[60vh] place-items-center text-sm text-zinc-500">
          This design is empty.
        </main>
      ) : (
        <main className="mx-auto flex max-w-[1600px] flex-col gap-12 p-8">
          {artboards.map((artboard) => (
            <article key={artboard.id} className="flex flex-col gap-3">
              <header className="flex items-center gap-3">
                <h2 className="text-base font-medium text-zinc-100">
                  {artboard.name}
                </h2>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {artboard.w} × {artboard.h}
                </span>
              </header>
              <div
                className="overflow-hidden rounded-lg border border-white/10 bg-white shadow-xl"
                style={{
                  width: artboard.w,
                  height: artboard.h,
                  maxWidth: "100%",
                }}
              >
                {artboard.design ? (
                  <DesignRenderer node={artboard.design} />
                ) : (
                  <div className="grid h-full w-full place-items-center text-zinc-400">
                    Empty artboard
                  </div>
                )}
              </div>
            </article>
          ))}
        </main>
      )}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const design = await db.query.designs.findFirst({
    where: eq(designs.shareToken, token),
    columns: { name: true },
  });
  return {
    title: design ? `${design.name} · yxuOS` : "Shared design · yxuOS",
  };
}
