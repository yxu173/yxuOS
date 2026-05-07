/**
 * Canonical list of statuses a task can be in. Order matters: this is
 * also the display order used in grouped views.
 */
export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

/**
 * Tone classes for status pills. Keep them subtle — saturated colours
 * fight with the rest of the app.
 */
export const TASK_STATUS_TONES: Record<TaskStatus, string> = {
  backlog: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  todo: "border-zinc-400/30 bg-zinc-400/10 text-zinc-200",
  in_progress: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  in_review: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  canceled: "border-red-500/30 bg-red-500/10 text-red-200",
};

export const TASK_PRIORITIES = [
  "no_priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  no_priority: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TASK_PRIORITY_TONES: Record<TaskPriority, string> = {
  no_priority: "text-zinc-500",
  low: "text-zinc-400",
  medium: "text-zinc-300",
  high: "text-orange-300",
  urgent: "text-red-300",
};

export function isValidStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isValidPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}
