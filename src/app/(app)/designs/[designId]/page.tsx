import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { designs } from "@/db/schema";
import { auth } from "@/lib/auth";

export default async function DesignPage({
  params,
}: {
  params: Promise<{ designId: string }>;
}) {
  const { designId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const design = await db.query.designs.findFirst({
    where: and(
      eq(designs.id, designId),
      eq(designs.ownerId, session.user.id),
    ),
    columns: { id: true, name: true },
  });

  if (!design) {
    notFound();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{design.name}</h1>
      <p className="text-sm text-muted-foreground">
        Design canvas lands in commit 3. The agent ships in commit 7.
      </p>
    </main>
  );
}
