import { AlertTriangle, Minus, Signal, SignalLow, SignalMedium } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/tasks/task-types";

export interface PriorityIconProps {
  priority: TaskPriority;
  className?: string;
}

/**
 * Visual indicator for task priority, modelled on Linear's signal-bar
 * + alert-triangle pattern.
 */
export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const Icon =
    priority === "urgent"
      ? AlertTriangle
      : priority === "high"
        ? Signal
        : priority === "medium"
          ? SignalMedium
          : priority === "low"
            ? SignalLow
            : Minus;

  const tone =
    priority === "urgent"
      ? "text-red-300"
      : priority === "high"
        ? "text-orange-300"
        : priority === "medium"
          ? "text-zinc-300"
          : priority === "low"
            ? "text-zinc-400"
            : "text-zinc-500";

  return (
    <Icon className={cn("size-3.5", tone, className)} strokeWidth={2.25} />
  );
}
