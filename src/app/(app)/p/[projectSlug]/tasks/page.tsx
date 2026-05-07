import { listTopLevelTasks } from "@/app/(app)/tasks/actions";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listTeamMembers, listUserTeams } from "@/lib/teams";

export const metadata = {
  title: "Tasks · yxuOS",
};

interface PageProps {
  params: Promise<{ projectSlug: string }>;
}

export default async function ProjectTasksIndexPage({ params }: PageProps) {
  const { projectSlug } = await params;

  const { session, teamId, projectId, projectName } =
    await requireActiveProject(projectSlug);

  const [tasks, teams, members] = await Promise.all([
    listTopLevelTasks(teamId, projectId),
    listUserTeams(session.user.id),
    listTeamMembers(teamId),
  ]);

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    username: m.username,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
        active="tasks"
        projectSlug={projectSlug}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Work in <span className="text-zinc-200">{projectName}</span>.
              Click a task to open it; click the status pill to move it
              through the pipeline.
            </p>
          </div>
          <CreateTaskDialog
            members={memberOptions}
            projectSlug={projectSlug}
          />
        </header>

        {tasks.length === 0 ? (
          <section className="grid h-72 place-items-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2 text-center">
              <p>No tasks yet.</p>
              <p className="text-xs">
                Create your first task to start tracking work in this project.
              </p>
            </div>
          </section>
        ) : (
          <TaskList tasks={tasks} members={memberOptions} />
        )}
      </main>
    </div>
  );
}
