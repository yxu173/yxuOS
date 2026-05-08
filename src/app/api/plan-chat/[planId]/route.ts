import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStreamResponse } from "ai";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { taskPlans } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";
import type { PlanningToolContext } from "@/mastra/tools/planning-workspace";

/**
 * Streaming chat endpoint for the Planner agent.
 *
 * Mirrors `/api/research-chat/[noteId]/route.ts`:
 *   1. Resolve session + active team.
 *   2. Verify the plan exists and belongs to the team.
 *   3. Build a `RequestContext` carrying `{teamId, projectId, planId}`
 *      so every planning tool reads the scope from server-known
 *      values, not anything the model emits.
 *   4. Hand off to `handleChatStream`, threading memory by the plan's
 *      `threadId` and resourcing by the project id (shared working
 *      memory across plans, same as the researcher).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;

  let teamId: string;
  try {
    const ctx = await requireActiveTeam();
    teamId = ctx.teamId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const plan = await db.query.taskPlans.findFirst({
    where: and(eq(taskPlans.id, planId), eq(taskPlans.teamId, teamId)),
    columns: { id: true, threadId: true, projectId: true },
  });
  if (!plan) {
    return new Response("Not found", { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await req.json()) as any;

  const requestContext = new RequestContext<{
    planning: PlanningToolContext;
  }>();
  requestContext.set("planning", {
    teamId,
    projectId: plan.projectId,
    planId: plan.id,
  });

  const stream = await handleChatStream({
    version: "v6",
    mastra,
    agentId: "planner",
    params: {
      ...body,
      requestContext,
      memory: {
        ...(body?.memory ?? {}),
        // Thread = plan id, resource = project id. Same shape as the
        // researcher route — the project working memory is shared
        // between researcher and planner because both use
        // `resource = projectId`.
        thread: plan.threadId,
        resource: plan.projectId,
      },
    },
  });

  return createUIMessageStreamResponse({ stream });
}
