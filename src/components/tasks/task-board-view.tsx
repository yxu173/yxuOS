"use client";

import { CalendarClock, CheckSquare2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import type { TaskListRow } from "@/app/(app)/tasks/actions";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

import type { AssigneeOption } from "./assignee-picker";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";

export interface TaskBoardViewProps {
  tasks: TaskListRow[];
  members: AssigneeOption[];
}

/** Status columns that show up by default in the board view. The
 *  closed states (`done`, `canceled`) live to the right so completed
 *  work doesn't dominate the user's first glance. */
const COLUMN_ORDER: TaskStatus[] = [...TASK_STATUSES];

const dueFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

/**
 * Kanban-style render mode for the tasks index. One column per status;
 * each column scrolls vertically when its stack exceeds the viewport,
 * the row of columns scrolls horizontally if the screen is too narrow
 * to fit them all.
 *
 * The card itself is intentionally minimal (priority dot, title, due
 * + assignee + sub-task badge) — the detail page is one click away
 * for anything richer. Drag-to-reorder is *not* wired up here yet;
 * status changes still go through each card's link → detail page,
 * matching the list view's behaviour.
 */
export function TaskBoardView({ tasks, members }: TaskBoardViewProps) {
  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, TaskListRow[]>();
    for (const status of COLUMN_ORDER) map.set(status, []);
    for (const task of tasks) map.get(task.status)?.push(task);
    return map;
  }, [tasks]);

  const memberById = useMemo(() => {
    const m = new Map<string, AssigneeOption>();
    for (const member of members) m.set(member.userId, member);
    return m;
  }, [members]);

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {COLUMN_ORDER.map((status) => {
          const items = grouped.get(status) ?? [];
          return (
            <BoardColumn key={status} status={status} count={items.length}>
              {items.length === 0 ? (
                <EmptyColumn />
              ) : (
                items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    member={
                      task.assignee ? memberById.get(task.assignee.userId) : undefined
                    }
                  />
                ))
              )}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
}

/* ─── column ──────────────────────────────────────── */

function BoardColumn({
  status,
  count,
  children,
}: {
  status: TaskStatus;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      // Fixed-width columns keep the kanban legible regardless of
      // task count. Tall stacks scroll inside the column.
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.015] p-2"
      aria-label={`${TASK_STATUS_LABELS[status]} column`}
    >
      <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-1">
        <StatusIcon status={status} />
        <span className="text-xs font-medium text-zinc-100">
          {TASK_STATUS_LABELS[status]}
        </span>
        <span className="text-[10px] tabular-nums text-zinc-500">
          {count}
        </span>
      </header>
      <div className="flex max-h-[calc(100vh-22rem)] flex-col gap-1.5 overflow-y-auto pr-0.5">
        {children}
      </div>
    </section>
  );
}

function EmptyColumn() {
  return (
    <p className="px-1.5 py-2 text-[11px] text-zinc-600">
      Nothing here yet.
    </p>
  );
}

/* ─── card ────────────────────────────────────────── */

function TaskCard({
  task,
  member,
}: {
  task: TaskListRow;
  member: AssigneeOption | undefined;
}) {
  const isClosed = task.status === "done" || task.status === "canceled";
  // Wrap the `Date.now()` call in a regular helper so the linter
  // doesn't flag an impure call inside the component body. Same
  // pattern `task-row.tsx` uses for the list view.
  const overdue = !isClosed && isOverdue(task.dueDate);

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={cn(
        "group flex flex-col gap-1.5 rounded-md border border-white/5 bg-zinc-900/40 px-2.5 py-2 text-left transition-colors",
        "hover:border-white/15 hover:bg-zinc-900/70 focus-visible:border-white/15 focus-visible:bg-zinc-900/70 focus-visible:outline-none",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <PriorityIcon priority={task.priority} />
        </span>
        <span
          className={cn(
            "line-clamp-3 text-sm leading-snug text-zinc-100",
            isClosed && "text-zinc-500 line-through decoration-zinc-600",
          )}
        >
          {task.title}
        </span>
      </div>

      {/* Meta strip — only renders if at least one piece of meta is
          present, so plain tasks stay genuinely minimal. */}
      {task.dueDate || task.subtaskCount > 0 || member ? (
        <div className="flex items-center gap-2 pl-5 text-[11px] text-zinc-500">
          {task.dueDate ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                overdue && "text-red-300",
              )}
              title={task.dueDate.toISOString()}
            >
              <CalendarClock className="size-3" />
              {dueFmt.format(task.dueDate)}
            </span>
          ) : null}
          {task.subtaskCount > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={`${task.doneSubtaskCount}/${task.subtaskCount} sub-tasks done`}
            >
              <CheckSquare2 className="size-3" />
              {task.doneSubtaskCount}/{task.subtaskCount}
            </span>
          ) : null}
          <span className="ml-auto">
            {member ? (
              <span
                className="grid size-5 place-items-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200"
                title={member.name}
              >
                {initials(member.name)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

function isOverdue(due: Date | null): boolean {
  if (!due) return false;
  return due.getTime() < Date.now();
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
