import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { notFound } from "next/navigation";

import { ResearchShell } from "@/components/research/research-shell";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";
import { mastra } from "@/mastra";

import { getResearchNote } from "@/app/(app)/research/actions";

/**
 * Hydrate the agent's persisted thread for this note's chat. Empty
 * for brand-new notes; populated as soon as the user sends a message.
 */
async function loadInitialMessages(
  threadId: string,
  resourceId: string,
): Promise<UIMessage[]> {
  try {
    const memory = await mastra.getAgentById("researcher").getMemory();
    if (!memory) return [];
    const result = await memory.recall({ threadId, resourceId });
    return toAISdkMessages(result.messages, { version: "v6" });
  } catch {
    return [];
  }
}

export default async function ResearchNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; noteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectSlug, noteId }, rawSearch] = await Promise.all([
    params,
    searchParams,
  ]);

  const { session, teamId, projectId } =
    await requireActiveProject(projectSlug);

  // Permission gate first — surface a 404 (not 403) for cross-team
  // ids so attackers can't enumerate.
  let note;
  try {
    note = await getResearchNote(noteId);
  } catch {
    notFound();
  }
  if (!note || note.projectId !== projectId) notFound();

  const [initialMessages, teams, projects] = await Promise.all([
    loadInitialMessages(note.threadId, projectId),
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
  ]);

  // The index page may redirect with `?ask=...` so the chat starts
  // mid-conversation on a fresh note.
  const askRaw = rawSearch.ask;
  const initialPrompt = (Array.isArray(askRaw) ? askRaw[0] : askRaw) ?? undefined;

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
      <ResearchShell
        noteId={note.id}
        initialTitle={note.title}
        initialBody={note.body}
        projectSlug={projectSlug}
        initialMessages={initialMessages}
        initialPrompt={initialPrompt}
      />
    </div>
  );
}
