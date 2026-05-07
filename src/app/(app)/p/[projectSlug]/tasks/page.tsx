import { listTaskBoardsForProject } from "@/app/(app)/tasks/board-actions";
import { listTopLevelTasks } from "@/app/(app)/tasks/actions";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskBoardStrip } from "@/components/tasks/task-board-strip";
import { TaskList } from "@/components/tasks/task-list";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listTeamMembers, listUserTeams } from "@/lib/teams";

export const metadata = {
  title: "Tasks · yxuOS",
};

interface PageProps {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<{ board?: string }>;
}

export default async function ProjectTasksIndexPage({
  params,
  searchParams,
}: PageProps) {
  const [{ projectSlug }, { board: requestedBoardId }] = await Promise.all([
    params,
    searchParams,
  ]);

  const { session, teamId, projectId, projectName } =
    await requireActiveProject(projectSlug);

  const [taskBoards, teams, projects, members] = await Promise.all([
    listTaskBoardsForProject(projectId),
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
    listTeamMembers(teamId),
  ]);

  // Validate the `?board=` param: it must point at a board on this
  // project. Anything else falls back to the cross-board "All" view.
  const activeBoardId =
    requestedBoardId &&
    taskBoards.some((board) => board.id === requestedBoardId)
      ? requestedBoardId
      : null;

  const tasks = await listTopLevelTasks(
    teamId,
    projectId,
    activeBoardId ?? undefined,
  );

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    username: m.username,
  }));

  const activeBoardName = activeBoardId
    ? taskBoards.find((board) => board.id === activeBoardId)?.name ?? null
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
        active="tasks"
        projectSlug={projectSlug}
        projects={projects}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Work in <span className="text-zinc-200">{projectName}</span>
              {activeBoardName ? (
                <>
                  {" "}
                  · viewing{" "}
                  <span className="text-zinc-200">{activeBoardName}</span>
                </>
              ) : null}
              .
            </p>
          </div>
          <CreateTaskDialog
            members={memberOptions}
            projectSlug={projectSlug}
            taskBoardId={activeBoardId}
          />
        </header>

        <TaskBoardStrip
          boards={taskBoards}
          projectSlug={projectSlug}
          activeBoardId={activeBoardId}
        />

        {tasks.length === 0 ? (
          <section className="grid h-72 place-items-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2 text-center">
              <p>
                {activeBoardId
                  ? "No tasks on this board yet."
                  : "No tasks yet."}
              </p>
              <p className="text-xs">
                {activeBoardId
                  ? `Create your first task to start filling "${activeBoardName}".`
                  : "Create your first task or pick a board to start filling."}
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
