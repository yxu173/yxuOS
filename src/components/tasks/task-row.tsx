"use client";

import { CheckSquare2 } from "lucide-react";
import Link from "next/link";

import type {
  TaskListRow,
} from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/utils";

import { AssigneePicker, type AssigneeOption } from "./assignee-picker";
import { PriorityPicker } from "./priority-picker";
import { StatusPicker } from "./status-picker";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

export interface TaskRowProps {
  task: TaskListRow;
  members: AssigneeOption[];
}

export function TaskRow({ task, members }: TaskRowProps) {
  const isDoneOrCancelled =
    task.status === "done" || task.status === "canceled";

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-none"
    >
      <PriorityPicker
        taskId={task.id}
        priority={task.priority}
        compact
      />
      <StatusPicker taskId={task.id} status={task.status} compact />

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-zinc-100",
          isDoneOrCancelled && "text-zinc-500 line-through decoration-zinc-600",
        )}
      >
        {task.title}
      </span>

      {task.subtaskCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400"
          title={`${task.doneSubtaskCount}/${task.subtaskCount} sub-tasks done`}
        >
          <CheckSquare2 className="size-3" />
          {task.doneSubtaskCount}/{task.subtaskCount}
        </span>
      ) : null}

      {task.dueDate ? (
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums text-zinc-500",
            isOverdue(task.dueDate, task.status) && "text-red-300",
          )}
          title={task.dueDate.toISOString()}
        >
          {dateFormatter.format(task.dueDate)}
        </span>
      ) : null}

      <AssigneePicker
        taskId={task.id}
        assignee={task.assignee}
        members={members}
        compact
      />
    </Link>
  );
}

function isOverdue(due: Date, status: string): boolean {
  if (status === "done" || status === "canceled") return false;
  return due.getTime() < Date.now();
}
