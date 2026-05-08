import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  isValidPriority,
  isValidStatus,
  type TaskPriority,
  type TaskStatus,
} from "./task-types";

/**
 * Sentinel id used in the assignee filter to mean "tasks with no
 * assignee". We can't use `null` as a URL value, and we can't pick a
 * real userId (a real user would clash) — `__unassigned__` is short,
 * unmistakable, and matches the same convention used in the create
 * dialog's UNASSIGNED constant.
 */
export const UNASSIGNED_FILTER_VALUE = "__unassigned__";

/**
 * The valid presets for the "Due" filter. Kept as preset buckets
 * rather than free-form date ranges because that's the question the
 * user is actually asking ("what's overdue?") and it keeps URLs short.
 *
 *  - `overdue`  — `due_date < now AND status NOT IN (done, canceled)`
 *  - `today`    — due today (calendar-day, in server's timezone)
 *  - `week`     — due in the next 7 calendar days (incl. today)
 *  - `none`     — `due_date IS NULL`
 *  - `any`      — explicit pass-through (default; same as omitting the filter)
 */
export const TASK_DUE_FILTERS = [
  "any",
  "overdue",
  "today",
  "week",
  "none",
] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const TASK_DUE_FILTER_LABELS: Record<TaskDueFilter, string> = {
  any: "Any due date",
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  none: "No due date",
};

export interface TaskListFilters {
  /** Multi-select. Empty array = all statuses. */
  statuses: TaskStatus[];
  /** Multi-select. Empty array = all priorities. */
  priorities: TaskPriority[];
  /**
   * Multi-select assignee user-ids; the special value
   * `UNASSIGNED_FILTER_VALUE` matches tasks with `assignee_id IS NULL`.
   * Empty array = no assignee filter at all (everyone + unassigned).
   */
  assignees: string[];
  due: TaskDueFilter;
  /** Free-form title search; trimmed, case-insensitive. */
  q: string;
}

export const EMPTY_TASK_FILTERS: TaskListFilters = {
  statuses: [],
  priorities: [],
  assignees: [],
  due: "any",
  q: "",
};

/* ─── URL <-> filters ─────────────────────────────── */

/**
 * Parse a typed `TaskListFilters` out of Next.js `searchParams`.
 *
 *  - Accepts both repeated params (`?status=todo&status=done`) and
 *    comma-separated lists (`?status=todo,done`). The Next router
 *    surfaces both shapes depending on how the URL was constructed,
 *    so we accept either to keep client → server symmetry trivial.
 *  - Drops unknown values silently — a stale URL bookmark with an
 *    obsolete status name shouldn't error, it should just ignore
 *    that token.
 */
export function parseTaskFilters(
  raw: Record<string, string | string[] | undefined>,
): TaskListFilters {
  const statuses = collectMulti(raw, "status").filter(isValidStatus);
  const priorities = collectMulti(raw, "priority").filter(isValidPriority);
  const assignees = collectMulti(raw, "assignee");
  const dueRaw = readSingle(raw, "due");
  const due: TaskDueFilter = (TASK_DUE_FILTERS as readonly string[]).includes(
    dueRaw ?? "",
  )
    ? (dueRaw as TaskDueFilter)
    : "any";
  const q = (readSingle(raw, "q") ?? "").trim().slice(0, 120);
  return { statuses, priorities, assignees, due, q };
}

/**
 * Serialise filters back into a URLSearchParams suitable for a
 * `<Link href="?...">` or `router.replace("?...")`.
 *
 *  - Empty / default values are omitted so the URL stays short.
 *  - Multi-select values are joined with commas (vs repeated keys)
 *    purely for readability.
 *  - The `board` param is preserved by the caller — we don't know
 *    about it here.
 */
export function serialiseTaskFilters(
  filters: TaskListFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.statuses.length > 0) {
    params.set("status", filters.statuses.join(","));
  }
  if (filters.priorities.length > 0) {
    params.set("priority", filters.priorities.join(","));
  }
  if (filters.assignees.length > 0) {
    params.set("assignee", filters.assignees.join(","));
  }
  if (filters.due !== "any") {
    params.set("due", filters.due);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  return params;
}

/**
 * Total filter dimensions currently in effect (used for the "X filters"
 * badge on the bar's clear button). The text-search field counts as a
 * single dimension regardless of how long the query is.
 */
export function countActiveFilters(filters: TaskListFilters): number {
  let n = 0;
  if (filters.statuses.length > 0) n += 1;
  if (filters.priorities.length > 0) n += 1;
  if (filters.assignees.length > 0) n += 1;
  if (filters.due !== "any") n += 1;
  if (filters.q.trim()) n += 1;
  return n;
}

/* ─── helpers ──────────────────────────────────────── */

function collectMulti(
  raw: Record<string, string | string[] | undefined>,
  key: string,
): string[] {
  const value = raw[key];
  if (!value) return [];
  const tokens = Array.isArray(value) ? value : [value];
  // `tokens` may itself contain comma-separated entries (e.g. when the
  // URL was shaped by `serialiseTaskFilters`). Splitting once flattens
  // both forms into a deduped list.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    for (const part of t.split(",")) {
      const trimmed = part.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function readSingle(
  raw: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/* ─── re-exports for convenience ───────────────────── */
export { TASK_PRIORITIES, TASK_STATUSES };
