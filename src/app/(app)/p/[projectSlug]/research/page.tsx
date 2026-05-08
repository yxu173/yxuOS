import { ResearchNoteCard } from "@/components/research/research-note-card";
import { ResearchPromptCard } from "@/components/research/research-prompt-card";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";

import { listResearchNotesForProject } from "@/app/(app)/research/actions";

export default async function ResearchIndexPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  const { session, teamId, projectId, projectName } =
    await requireActiveProject(projectSlug);

  const [notes, teams, projects] = await Promise.all([
    listResearchNotesForProject(projectId),
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
        active="agents"
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Research
          </h1>
          <p className="text-sm text-muted-foreground">
            Decision records, explorations, and tradeoff comparisons —
            scoped to{" "}
            <span className="text-zinc-200">{projectName}</span>.
          </p>
        </header>

        <ResearchPromptCard projectSlug={projectSlug} />

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Recent
            </h2>
            <span className="text-[10px] tabular-nums text-zinc-600">
              {notes.length} {notes.length === 1 ? "note" : "notes"}
            </span>
          </div>
          {notes.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.015] px-4 py-8 text-center text-sm text-zinc-500">
              No research notes yet — ask the researcher above.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <li key={note.id}>
                  <ResearchNoteCard
                    note={note}
                    projectSlug={projectSlug}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
