import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStreamResponse } from "ai";

import { db } from "@/db";
import { taskPlans } from "@/db/schema";
import {
  generateChatTitle,
  extractFirstUserText,
  needsTitle,
} from "@/lib/ai/chat-title";
import { wrapStreamWithTitle } from "@/lib/ai/stream-title";
import { safeChatStream } from "@/lib/ai/safe-chat-stream";
import { and, eq } from "drizzle-orm";
import { requireActiveTeam } from "@/lib/permissions";
import { mastra } from "@/mastra";
import type { PlanningToolContext } from "@/mastra/tools/planning-workspace";
import type { ProjectToolContext } from "@/mastra/tools/search-knowledge";

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
    columns: { id: true, threadId: true, projectId: true, title: true },
  });
  if (!plan) {
    return new Response("Not found", { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await req.json()) as any;

  // ── Auto-title generation ──────────────────────────────────
  let generatedTitle: string | null = null;
  if (needsTitle(plan.title)) {
    const firstUserText = extractFirstUserText(body);
    if (firstUserText) {
      generatedTitle = await generateChatTitle(firstUserText);
      await db
        .update(taskPlans)
        .set({ title: generatedTitle, updatedAt: new Date() })
        .where(and(eq(taskPlans.id, planId), eq(taskPlans.teamId, teamId)));
    }
  }

  const requestContext = new RequestContext<{
    planning: PlanningToolContext;
    project: ProjectToolContext;
  }>();
  requestContext.set("planning", {
    teamId,
    projectId: plan.projectId,
    planId: plan.id,
  });
  requestContext.set("project", {
    teamId,
    projectId: plan.projectId,
  });

  let upstream = await handleChatStream({
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

  if (generatedTitle) {
    upstream = wrapStreamWithTitle(upstream, generatedTitle);
  }

  // Friendly-error wrap — see `safeChatStream` for the rationale.
  return createUIMessageStreamResponse({ stream: safeChatStream(upstream) });
}
