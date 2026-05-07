import { Check, CircleDashed, Pause } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/tasks/task-types";

export interface StatusIconProps {
  status: TaskStatus;
  className?: string;
}

/**
 * Linear-style status indicator.
 *
 * Each status renders as a small circle with a fill ratio that hints at
 * progress: empty for backlog/todo, partial for in-progress / in-review,
 * full for done, and a struck-through pause icon for canceled.
 *
 * Implemented as inline SVG rather than a stack of Tailwind backgrounds
 * because the partial-fill arcs (3/8 and 5/8) are easier to reason about
 * as path data.
 */
export function StatusIcon({ status, className }: StatusIconProps) {
  if (status === "backlog") {
    return (
      <CircleDashed
        className={cn("size-4 text-zinc-500", className)}
        strokeWidth={1.75}
        aria-label="Backlog"
      />
    );
  }
  if (status === "canceled") {
    return (
      <Pause
        className={cn("size-4 text-red-300/80 rotate-90", className)}
        strokeWidth={2}
        aria-label="Canceled"
      />
    );
  }
  if (status === "done") {
    return (
      <span
        aria-label="Done"
        className={cn(
          "grid size-4 place-items-center rounded-full bg-emerald-500 text-emerald-950",
          className,
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }

  // Open ring with a progress arc — todo / in-progress / in-review.
  // The progress portion is rendered as a stroke-dasharray on the same
  // circle, which gives us crisp arcs without a separate path.
  const ratio =
    status === "todo" ? 0 : status === "in_progress" ? 0.6 : 0.85;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;
  const colour =
    status === "in_progress"
      ? "text-amber-300"
      : status === "in_review"
        ? "text-violet-300"
        : "text-zinc-400";

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className={cn(colour, className)}
      aria-label={status === "todo" ? "Todo" : status === "in_progress" ? "In progress" : "In review"}
    >
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      {dash > 0 ? (
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeDasharray={`${dash} ${circumference - dash}`}
          // Start at 12 o'clock and move clockwise.
          transform="rotate(-90 8 8)"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
