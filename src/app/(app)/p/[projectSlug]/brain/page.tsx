import { BrainSearch } from "@/components/brain/brain-search";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";

/**
 * `/p/<slug>/brain` — semantic-search surface for the project brain.
 *
 * Reads cleanly compose `BrainSearch` (a client component) which
 * talks to `/api/brain/search`. Page-level work here is the standard
 * permission-gated team/project resolution + chrome.
 *
 * Why a dedicated page (instead of bolting onto Cmd+K): semantic
 * search is for "what does this project know about X?" — a
 * deliberate investigation surface — while Cmd+K is for instant
 * jump-to-thing. The two affordances stay clearer when separated.
 */
export default async function BrainPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  const { session, teamId, projectName } =
    await requireActiveProject(projectSlug);

  const [teams, projects] = await Promise.all([
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name ?? "You"}
        userEmail={session.user.email}
        projectSlug={projectSlug}
        projects={projects}
        // The brain lives under the agents-dropdown so we light up
        // that section in the top bar.
        active="agents"
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Project brain
          </h1>
          <p className="text-sm text-muted-foreground">
            Semantic recall across research, plans, tasks, boards,
            designs, and comments in{" "}
            <span className="text-zinc-200">{projectName}</span>. Ask
            it questions — the agents use this same store.
          </p>
        </header>

        <BrainSearch projectSlug={projectSlug} />
      </main>
    </div>
  );
}
