import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { listCommentsForSubject } from "@/app/(app)/comments/actions";
import {
  getTaskDetail,
  type TaskListRow,
} from "@/app/(app)/tasks/actions";
import { InlineCommentsThread } from "@/components/comments/inline-thread";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { DueDatePicker } from "@/components/tasks/due-date-picker";
import {
  InlineTaskDescription,
  InlineTaskTitle,
} from "@/components/tasks/inline-text-edit";
import { PriorityPicker } from "@/components/tasks/priority-picker";
import { StatusPicker } from "@/components/tasks/status-picker";
import { TaskRow } from "@/components/tasks/task-row";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveTeam } from "@/lib/permissions";
import { listTeamMembers, listUserTeams } from "@/lib/teams";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface TaskPageParams {
  params: Promise<{ taskId: string }>;
}

export default async function TaskDetailPage({ params }: TaskPageParams) {
  const { taskId } = await params;

  const { session, teamId } = await requireActiveTeam();

  const [task, teams, members, comments] = await Promise.all([
    getTaskDetail(taskId),
    listUserTeams(session.user.id),
    listTeamMembers(teamId),
    listCommentsForSubject("task", taskId),
  ]);

  if (!task) notFound();

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    username: m.username,
  }));

  // Render subtasks via the same TaskRow used on the index. Subtasks
  // don't carry every TaskListRow field — synthesise the missing ones so
  // we get a single visual treatment.
  const subtaskRows: TaskListRow[] = task.subtasks.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    priority: s.priority,
    dueDate: null,
    updatedAt: new Date(0),
    parentTaskId: task.id,
    assignee: s.assignee,
    subtaskCount: 0,
    doneSubtaskCount: 0,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
        active="tasks"
      />

      <main className="mx-auto grid w-full max-w-6xl gap-8 p-8 md:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <nav className="flex items-center gap-2 text-sm text-zinc-400">
            <Link
              href="/tasks"
              className="inline-flex items-center gap-1 hover:text-zinc-200"
            >
              <ArrowLeft className="size-3.5" />
              All tasks
            </Link>
            {task.parentTask ? (
              <>
                <span className="text-zinc-600">·</span>
                <Link
                  href={`/tasks/${task.parentTask.id}`}
                  className="hover:text-zinc-200"
                >
                  Parent: {task.parentTask.title}
                </Link>
              </>
            ) : null}
          </nav>

          <header className="flex flex-col gap-3">
            <InlineTaskTitle taskId={task.id} initialValue={task.title} />
            <div className="flex flex-wrap items-center gap-2">
              <StatusPicker taskId={task.id} status={task.status} />
              <PriorityPicker taskId={task.id} priority={task.priority} />
              <AssigneePicker
                taskId={task.id}
                assignee={task.assignee}
                members={memberOptions}
              />
              <DueDatePicker taskId={task.id} dueDate={task.dueDate} />
            </div>
          </header>

          <section className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Description
            </h2>
            <InlineTaskDescription
              taskId={task.id}
              initialValue={task.description ?? ""}
            />
          </section>

          {task.parentTask ? null : (
            <section className="flex flex-col gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-4">
              <header className="flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Sub-tasks ({task.subtasks.length})
                </h2>
                <CreateTaskDialog
                  members={memberOptions}
                  parentTaskId={task.id}
                  inline
                />
              </header>
              {subtaskRows.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No sub-tasks yet. Break this down into smaller pieces if
                  it helps.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {subtaskRows.map((s) => (
                    <li key={s.id}>
                      <TaskRow task={s} members={memberOptions} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <InlineCommentsThread
            subjectType="task"
            subjectId={task.id}
            initialComments={comments}
            members={memberOptions}
          />
        </div>

        <aside className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Properties
            </h2>
            <PropertyRow label="Status">
              <StatusPicker taskId={task.id} status={task.status} />
            </PropertyRow>
            <PropertyRow label="Priority">
              <PriorityPicker taskId={task.id} priority={task.priority} />
            </PropertyRow>
            <PropertyRow label="Assignee">
              <AssigneePicker
                taskId={task.id}
                assignee={task.assignee}
                members={memberOptions}
              />
            </PropertyRow>
            <PropertyRow label="Due">
              <DueDatePicker taskId={task.id} dueDate={task.dueDate} />
            </PropertyRow>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-4 text-xs text-zinc-400">
            <p>
              Created by{" "}
              <span className="text-zinc-200">{task.creator.name}</span>
              {task.creator.username ? (
                <span className="ml-1 text-zinc-500">
                  @{task.creator.username}
                </span>
              ) : null}
            </p>
            <p>
              <span className="text-zinc-500">Created:</span>{" "}
              {dateFormatter.format(task.createdAt)}
            </p>
            <p>
              <span className="text-zinc-500">Updated:</span>{" "}
              {dateFormatter.format(task.updatedAt)}
            </p>
            {task.completedAt ? (
              <p>
                <span className="text-zinc-500">Completed:</span>{" "}
                {dateFormatter.format(task.completedAt)}
              </p>
            ) : null}
          </section>

          <DeleteTaskButton
            taskId={task.id}
            taskTitle={task.title}
            redirectTo={
              task.parentTask ? `/tasks/${task.parentTask.id}` : "/tasks"
            }
          />
        </aside>
      </main>
    </div>
  );
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

export async function generateMetadata({ params }: TaskPageParams) {
  const { taskId } = await params;
  const task = await getTaskDetail(taskId).catch(() => null);
  return { title: task ? `${task.title} · Tasks · yxuOS` : "Task · yxuOS" };
}
