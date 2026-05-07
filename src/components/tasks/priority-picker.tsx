"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { updateTask } from "@/app/(app)/tasks/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type TaskPriority,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

import { PriorityIcon } from "./priority-icon";

export interface PriorityPickerProps {
  taskId: string;
  priority: TaskPriority;
  compact?: boolean;
}

export function PriorityPicker({
  taskId,
  priority,
  compact = false,
}: PriorityPickerProps) {
  const [optimistic, setOptimistic] = useState<TaskPriority | null>(null);
  const [pending, startTransition] = useTransition();
  const current = optimistic ?? priority;

  const setPriority = (next: TaskPriority) => {
    if (next === current) return;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await updateTask({ taskId, priority: next });
      } catch (err) {
        setOptimistic(null);
        alert(err instanceof Error ? err.message : "Failed to update priority");
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/5",
            pending && "opacity-70",
          )}
          aria-label={`Priority: ${TASK_PRIORITY_LABELS[current]}`}
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
        >
          <PriorityIcon priority={current} />
          {!compact ? (
            <span className="truncate">{TASK_PRIORITY_LABELS[current]}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Set priority
        </DropdownMenuLabel>
        {[...TASK_PRIORITIES].reverse().map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => setPriority(option)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <PriorityIcon priority={option} />
              {TASK_PRIORITY_LABELS[option]}
            </span>
            {option === current ? (
              <Check className="size-3.5 text-zinc-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
