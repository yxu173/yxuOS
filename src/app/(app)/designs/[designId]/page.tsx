import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DesignShell } from "@/components/design/design-shell";
import type { Artboard } from "@/components/design/types";
import { db } from "@/db";
import { designs } from "@/db/schema";
import { auth } from "@/lib/auth";

interface DesignSnapshot {
  artboards?: Artboard[];
}

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
    columns: { id: true, name: true, snapshot: true },
  });

  if (!design) {
    notFound();
  }

  const snapshot = (design.snapshot as DesignSnapshot | null) ?? null;
  const initialArtboards = snapshot?.artboards ?? [];

  return (
    <DesignShell
      designId={design.id}
      designName={design.name}
      initialArtboards={initialArtboards}
    />
  );
}
