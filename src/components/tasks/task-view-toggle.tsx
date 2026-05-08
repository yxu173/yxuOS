"use client";

import { Columns3, List } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { DEFAULT_TASK_VIEW, type TaskView } from "@/lib/tasks/task-view";
import { cn } from "@/lib/utils";

export interface TaskViewToggleProps {
  /** Server-parsed view, used as the visual selection on first paint. */
  current: TaskView;
}

/**
 * Two-option segmented control that flips the tasks index between the
 * grouped list view and the kanban-by-status board view.
 *
 * URL-driven: writes `?view=list|board` (and removes the param when
 * it would equal the default) so the choice survives reloads, sharing,
 * and browser back. All other search params are preserved verbatim,
 * so toggling the view never wipes the user's filters or active
 * board.
 */
export function TaskViewToggle({ current }: TaskViewToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const select = (next: TaskView) => {
    if (next === current) return;
    // Clone the existing query so we don't accidentally drop sibling
    // params (filters, ?board=, etc.). `URLSearchParams` from
    // `useSearchParams` is read-only, so wrap it.
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_TASK_VIEW) {
      params.delete("view");
    } else {
      params.set("view", next);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Task view"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.02] p-0.5 transition-opacity",
        isPending && "opacity-70",
      )}
    >
      <ViewBtn
        view="list"
        current={current}
        icon={List}
        label="List"
        onSelect={select}
      />
      <ViewBtn
        view="board"
        current={current}
        icon={Columns3}
        label="Board"
        onSelect={select}
      />
    </div>
  );
}

function ViewBtn({
  view,
  current,
  icon: Icon,
  label,
  onSelect,
}: {
  view: TaskView;
  current: TaskView;
  icon: typeof List;
  label: string;
  onSelect: (next: TaskView) => void;
}) {
  const active = view === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(view)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
        active
          ? "bg-white/10 text-zinc-50"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
