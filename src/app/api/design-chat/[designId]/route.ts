import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { designs } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ designId: string }> },
) {
  const { designId } = await params;

  let teamId: string;
  let session: Awaited<ReturnType<typeof requireActiveTeam>>["session"];
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
    session = ctx.session;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Confirm the design exists and is owned by the active team.
  const design = await db.query.designs.findFirst({
    where: and(
      eq(designs.id, designId),
      eq(designs.teamId, teamId),
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
