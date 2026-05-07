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
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

import { StatusIcon } from "./status-icon";

export interface StatusPickerProps {
  taskId: string;
  status: TaskStatus;
  /** Compact (icon-only) mode used in row hover states. Default false renders the label too. */
  compact?: boolean;
}

/**
 * Click-to-change status pill. Optimistically updates the local view so
 * the user gets instant feedback; the server's revalidatePath reconciles
 * once the action returns.
 */
export function StatusPicker({
  taskId,
  status,
  compact = false,
}: StatusPickerProps) {
  const [optimistic, setOptimistic] = useState<TaskStatus | null>(null);
  const [pending, startTransition] = useTransition();
  const current = optimistic ?? status;

  const setStatus = (next: TaskStatus) => {
    if (next === current) return;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await updateTask({ taskId, status: next });
      } catch (err) {
        setOptimistic(null);
        alert(err instanceof Error ? err.message : "Failed to update status");
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
          aria-label={`Status: ${TASK_STATUS_LABELS[current]}`}
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
        >
          <StatusIcon status={current} />
          {!compact ? (
            <span className="truncate">{TASK_STATUS_LABELS[current]}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Set status
        </DropdownMenuLabel>
        {TASK_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => setStatus(option)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <StatusIcon status={option} />
              {TASK_STATUS_LABELS[option]}
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
