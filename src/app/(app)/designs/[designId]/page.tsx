import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DesignShell } from "@/components/design/design-shell";
import type { Artboard } from "@/components/design/types";
import { db } from "@/db";
import { designs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { mastra } from "@/mastra";

interface DesignSnapshot {
  artboards?: Artboard[];
}

async function loadInitialMessages(
  threadId: string,
  resourceId: string,
): Promise<UIMessage[]> {
  try {
    const memory = await mastra.getAgentById("designArchitect").getMemory();
    if (!memory) return [];
    const result = await memory.recall({ threadId, resourceId });
    return toAISdkMessages(result.messages, { version: "v6" });
  } catch {
    return [];
  }
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
    columns: { id: true, name: true, snapshot: true, threadId: true },
  });

  if (!design) {
    notFound();
  }

  const snapshot = (design.snapshot as DesignSnapshot | null) ?? null;
  const initialArtboards = snapshot?.artboards ?? [];
  const initialMessages = await loadInitialMessages(
    design.threadId,
    session.user.id,
  );

  return (
    <DesignShell
      designId={design.id}
      designName={design.name}
      initialArtboards={initialArtboards}
      initialMessages={initialMessages}
    />
  );
}
