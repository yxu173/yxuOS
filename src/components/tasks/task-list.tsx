"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { TaskListRow } from "@/app/(app)/tasks/actions";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

import type { AssigneeOption } from "./assignee-picker";
import { StatusIcon } from "./status-icon";
import { TaskRow } from "./task-row";

export interface TaskListProps {
  tasks: TaskListRow[];
  members: AssigneeOption[];
}

/**
 * Renders the team's top-level tasks grouped by status, in
 * `TASK_STATUSES` order (backlog → canceled). Empty groups are hidden
 * by default; click the small "Show empty" toggle to surface them when
 * you want to drag/move things in.
 */
export function TaskList({ tasks, members }: TaskListProps) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(
    () => new Set(["done", "canceled"]),
  );

  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, TaskListRow[]>();
    for (const status of TASK_STATUSES) map.set(status, []);
    for (const task of tasks) map.get(task.status)?.push(task);
    return map;
  }, [tasks]);

  const toggleCollapse = (status: TaskStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const visibleStatuses = TASK_STATUSES.filter((status) => {
    if ((grouped.get(status)?.length ?? 0) > 0) return true;
    return showEmpty;
  });

  return (
    <div className="flex flex-col gap-1">
      {visibleStatuses.map((status) => {
        const items = grouped.get(status) ?? [];
        const isCollapsed = collapsed.has(status);
        return (
          <section
            key={status}
            className="rounded-lg border border-white/5 bg-white/[0.015]"
          >
            <button
              type="button"
              onClick={() => toggleCollapse(status)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5 text-zinc-500" />
              ) : (
                <ChevronDown className="size-3.5 text-zinc-500" />
              )}
              <StatusIcon status={status} />
              <span className="text-sm font-medium text-zinc-100">
                {TASK_STATUS_LABELS[status]}
              </span>
              <span className="text-xs tabular-nums text-zinc-500">
                {items.length}
              </span>
            </button>

            {!isCollapsed ? (
              <div
                className={cn(
                  "flex flex-col gap-0.5 px-1.5 pb-1.5",
                  items.length === 0 && "px-3 pb-3",
                )}
              >
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing here yet.
                  </p>
                ) : (
                  items.map((task) => (
                    <TaskRow key={task.id} task={task} members={members} />
                  ))
                )}
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {showEmpty ? "Hide empty groups" : "Show empty groups"}
        </button>
      </div>
    </div>
  );
}
