import { listTaskBoardsForProject } from "@/app/(app)/tasks/board-actions";
import { listTopLevelTasks } from "@/app/(app)/tasks/actions";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskBoardStrip } from "@/components/tasks/task-board-strip";
import { TaskFiltersBar } from "@/components/tasks/task-filters-bar";
import { TaskList } from "@/components/tasks/task-list";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import {
  countActiveFilters,
  parseTaskFilters,
} from "@/lib/tasks/task-filters";
import { listTeamMembers, listUserTeams } from "@/lib/teams";

export const metadata = {
  title: "Tasks · yxuOS",
};

interface PageProps {
  params: Promise<{ projectSlug: string }>;
  // Filter params live alongside `board` in the URL. We accept the
  // permissive shape Next gives us (string | string[] | undefined)
  // and let `parseTaskFilters` do the validation.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Fold the visible tasks down to a small summary block (overdue
 * count + done count). Pulled out into a regular function so the
 * non-deterministic `Date.now()` call lives outside the server
 * component's render body — satisfies `react-hooks/purity` while
 * keeping the math co-located with its caller.
 */
function summariseTaskCounts(
  tasks: Awaited<ReturnType<typeof listTopLevelTasks>>,
): { overdueCount: number; doneCount: number } {
  const now = Date.now();
  let overdueCount = 0;
  let doneCount = 0;
  for (const t of tasks) {
    if (t.status === "done") doneCount += 1;
    if (
      t.dueDate &&
      t.status !== "done" &&
      t.status !== "canceled" &&
      t.dueDate.getTime() < now
    ) {
      overdueCount += 1;
    }
  }
  return { overdueCount, doneCount };
}

export default async function ProjectTasksIndexPage({
  params,
  searchParams,
}: PageProps) {
  const [{ projectSlug }, rawSearch] = await Promise.all([
    params,
    searchParams,
  ]);

  const requestedBoardIdRaw = rawSearch.board;
  const requestedBoardId = Array.isArray(requestedBoardIdRaw)
    ? requestedBoardIdRaw[0]
    : requestedBoardIdRaw;
  const filters = parseTaskFilters(rawSearch);

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
    filters,
  );

  // Summary counts — derived from the same filtered set the list
  // shows so the user never sees a mismatch between the badge
  // ("3 overdue") and the visible rows. The "now" anchor is captured
  // inside the helper so React's purity linter doesn't flag a
  // top-level `Date.now()` call inside this server component.
  const { overdueCount, doneCount } = summariseTaskCounts(tasks);
  const hasActiveFilters = countActiveFilters(filters) > 0;

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

        <TaskFiltersBar
          members={memberOptions}
          initial={filters}
          matchedCount={tasks.length}
          overdueCount={overdueCount}
          doneCount={doneCount}
        />

        {tasks.length === 0 ? (
          <section className="grid h-72 place-items-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2 text-center">
              {hasActiveFilters ? (
                <>
                  <p>No tasks match these filters.</p>
                  <p className="text-xs">
                    Try clearing a filter, or create a new task that fits
                    them.
                  </p>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </section>
        ) : (
          <TaskList tasks={tasks} members={memberOptions} />
        )}
      </main>
    </div>
  );
}
