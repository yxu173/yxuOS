import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { notFound } from "next/navigation";

import { getPlan } from "@/app/(app)/plans/actions";
import { PlanShell } from "@/components/plans/plan-shell";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";
import { mastra } from "@/mastra";

async function loadInitialMessages(
  threadId: string,
  resourceId: string,
): Promise<UIMessage[]> {
  try {
    const memory = await mastra.getAgentById("planner").getMemory();
    if (!memory) return [];
    const result = await memory.recall({ threadId, resourceId });
    return toAISdkMessages(result.messages, { version: "v6" });
  } catch {
    return [];
  }
}

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectSlug, planId }, rawSearch] = await Promise.all([
    params,
    searchParams,
  ]);

  const { session, teamId, projectId } =
    await requireActiveProject(projectSlug);

  let plan;
  try {
    plan = await getPlan(planId);
  } catch {
    notFound();
  }
  if (!plan || plan.projectId !== projectId) notFound();

  const [initialMessages, teams, projects] = await Promise.all([
    loadInitialMessages(plan.threadId, projectId),
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
  ]);

  // The index page uses `?ask=` to seed the first turn after creating
  // a fresh plan. Same convention as the research surface.
  const askRaw = rawSearch.ask;
  const initialPrompt =
    (Array.isArray(askRaw) ? askRaw[0] : askRaw) ?? undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name ?? "You"}
        userEmail={session.user.email}
        projectSlug={projectSlug}
        projects={projects}
        active="agents"
      />
      <PlanShell
        plan={plan}
        initialMessages={initialMessages}
        initialPrompt={initialPrompt}
      />
    </div>
  );
}
