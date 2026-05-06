import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { designs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { mastra } from "@/mastra";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ designId: string }> },
) {
  const { designId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Confirm the design exists and belongs to this user.
  const design = await db.query.designs.findFirst({
    where: and(
      eq(designs.id, designId),
      eq(designs.ownerId, session.user.id),
    ),
    columns: { id: true, threadId: true },
  });
  if (!design) {
    return new Response("Not found", { status: 404 });
  }

  const body = await req.json();

  const stream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "designArchitect",
    params: {
      ...body,
      memory: {
        ...(body?.memory ?? {}),
        thread: design.threadId,
        resource: session.user.id,
      },
    },
  });

  return createUIMessageStreamResponse({ stream });
}
