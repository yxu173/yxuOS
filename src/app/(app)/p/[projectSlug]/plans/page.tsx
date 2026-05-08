import { listPlansForProject } from "@/app/(app)/plans/actions";
import { PlanCard } from "@/components/plans/plan-card";
import { PlanPromptCard } from "@/components/plans/plan-prompt-card";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";

export default async function PlansIndexPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  const { session, teamId, projectId, projectName } =
    await requireActiveProject(projectSlug);

  const [plans, teams, projects] = await Promise.all([
    listPlansForProject(projectId),
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
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground">
            Structured proposals to break work into approvable task rows
            — scoped to{" "}
            <span className="text-zinc-200">{projectName}</span>.
          </p>
        </header>

        <PlanPromptCard projectSlug={projectSlug} />

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Recent
            </h2>
            <span className="text-[10px] tabular-nums text-zinc-600">
              {plans.length} {plans.length === 1 ? "plan" : "plans"}
            </span>
          </div>
          {plans.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.015] px-4 py-8 text-center text-sm text-zinc-500">
              No plans yet — ask the planner above, or hand off from a
              research note.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <PlanCard plan={plan} projectSlug={projectSlug} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
