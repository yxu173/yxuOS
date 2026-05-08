/**
 * Render-mode for the tasks index. Kept separate from
 * {@link TaskListFilters} because the view doesn't change *which*
 * tasks are loaded — it only changes how we lay them out — and
 * pulling it out keeps the filter module pure / cacheable.
 */
export const TASK_VIEWS = ["list", "board"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const DEFAULT_TASK_VIEW: TaskView = "list";

/**
 * Read the `?view=` search-param off a Next.js `searchParams` object
 * and coerce it to a known view. Anything unrecognised falls back to
 * the default — a stale URL bookmark with `?view=galactic` shouldn't
 * break the page.
 */
export function parseTaskView(
  raw: Record<string, string | string[] | undefined>,
): TaskView {
  const value = raw.view;
  const single = Array.isArray(value) ? value[0] : value;
  if (single && (TASK_VIEWS as readonly string[]).includes(single)) {
    return single as TaskView;
  }
  return DEFAULT_TASK_VIEW;
}
