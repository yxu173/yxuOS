"use client";

import {
  CalendarClock,
  CircleDashed,
  Filter,
  Search,
  SlidersHorizontal,
  Tag,
  UserCircle2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  TASK_DUE_FILTERS,
  TASK_DUE_FILTER_LABELS,
  UNASSIGNED_FILTER_VALUE,
  countActiveFilters,
  serialiseTaskFilters,
  type TaskDueFilter,
  type TaskListFilters,
} from "@/lib/tasks/task-filters";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

import { type AssigneeOption } from "./assignee-picker";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";

export interface TaskFiltersBarProps {
  members: AssigneeOption[];
  /** Filters parsed by the server from the URL — initial render state. */
  initial: TaskListFilters;
  /**
   * Total tasks matching the current filters (rendered server-side).
   * Drives the "X tasks · Y overdue" summary on the bar.
   */
  matchedCount: number;
  /** Of the matched rows, how many are overdue. */
  overdueCount: number;
  /** Of the matched rows, how many are done. */
  doneCount: number;
}

/**
 * Filter strip for the tasks index — sits above the grouped task list.
 *
 * Architecture: filters are URL-driven so they're shareable and survive
 * page reloads. The bar reads its current state from `useSearchParams`
 * (so navigating "back" gives the right state) and pushes new state
 * via `router.replace()` whenever the user touches a control. The
 * actual filtering happens on the server in `listTopLevelTasks` —
 * this component is a pure URL editor.
 *
 * The text-search input is debounced (300ms) so typing doesn't
 * thrash the router; everything else fires immediately.
 */
export function TaskFiltersBar({
  members,
  initial,
  matchedCount,
  overdueCount,
  doneCount,
}: TaskFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local optimistic copy of the filters. Synced from `initial` (the
  // server-parsed value) on every render so SSR-driven changes win,
  // but we mutate it locally for instant UI feedback before the route
  // update lands.
  const [filters, setFilters] = useState<TaskListFilters>(initial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(initial);
  }, [initial]);

  const apply = (next: TaskListFilters) => {
    setFilters(next);
    const params = serialiseTaskFilters(next);
    // Preserve the `board=` param — it's owned by the board strip
    // sibling component, not by us.
    const board = searchParams.get("board");
    if (board) params.set("board", board);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  };

  /* ─── individual control handlers ─────────────────── */

  const toggleStatus = (status: TaskStatus) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    apply({ ...filters, statuses: next });
  };
  const togglePriority = (priority: TaskPriority) => {
    const next = filters.priorities.includes(priority)
      ? filters.priorities.filter((p) => p !== priority)
      : [...filters.priorities, priority];
    apply({ ...filters, priorities: next });
  };
  const toggleAssignee = (id: string) => {
    const next = filters.assignees.includes(id)
      ? filters.assignees.filter((a) => a !== id)
      : [...filters.assignees, id];
    apply({ ...filters, assignees: next });
  };
  const setDue = (due: TaskDueFilter) => apply({ ...filters, due });
  const setQuery = (q: string) => apply({ ...filters, q });
  const clearAll = () =>
    apply({
      statuses: [],
      priorities: [],
      assignees: [],
      due: "any",
      q: "",
    });

  /* ─── derived label helpers ─────────────────────────── */

  const activeCount = countActiveFilters(filters);

  const memberById = useMemo(() => {
    const map = new Map<string, AssigneeOption>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-opacity",
        isPending && "opacity-80",
      )}
      aria-label="Task filters"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 pr-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          <SlidersHorizontal className="size-3" />
          Filter
        </div>

        <SearchInput value={filters.q} onChange={setQuery} />

        <FilterDropdown
          icon={CircleDashed}
          label="Status"
          activeCount={filters.statuses.length}
          activeSummary={summariseTokens(
            filters.statuses,
            (s) => TASK_STATUS_LABELS[s],
          )}
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Status
          </DropdownMenuLabel>
          {TASK_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={filters.statuses.includes(status)}
              onSelect={(event) => {
                event.preventDefault();
                toggleStatus(status);
              }}
              className="gap-2"
            >
              <StatusIcon status={status} />
              {TASK_STATUS_LABELS[status]}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>

        <FilterDropdown
          icon={Tag}
          label="Priority"
          activeCount={filters.priorities.length}
          activeSummary={summariseTokens(
            filters.priorities,
            (p) => TASK_PRIORITY_LABELS[p],
          )}
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Priority
          </DropdownMenuLabel>
          {[...TASK_PRIORITIES].reverse().map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={filters.priorities.includes(priority)}
              onSelect={(event) => {
                event.preventDefault();
                togglePriority(priority);
              }}
              className="gap-2"
            >
              <PriorityIcon priority={priority} />
              {TASK_PRIORITY_LABELS[priority]}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>

        <FilterDropdown
          icon={UserCircle2}
          label="Assignee"
          activeCount={filters.assignees.length}
          activeSummary={summariseTokens(filters.assignees, (id) => {
            if (id === UNASSIGNED_FILTER_VALUE) return "Unassigned";
            return memberById.get(id)?.name ?? "Unknown";
          })}
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Assignee
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={filters.assignees.includes(UNASSIGNED_FILTER_VALUE)}
            onSelect={(event) => {
              event.preventDefault();
              toggleAssignee(UNASSIGNED_FILTER_VALUE);
            }}
            className="gap-2"
          >
            <span className="grid size-4 shrink-0 place-items-center rounded-full border border-dashed border-white/15 text-[8px] text-zinc-500">
              ?
            </span>
            Unassigned
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {members.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.userId}
              checked={filters.assignees.includes(m.userId)}
              onSelect={(event) => {
                event.preventDefault();
                toggleAssignee(m.userId);
              }}
              className="gap-2"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-zinc-800 text-[8px] font-semibold text-zinc-200">
                {initials(m.name)}
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5 truncate">
                <span className="truncate text-zinc-100">{m.name}</span>
                {m.username ? (
                  <span className="text-[10px] text-zinc-500">
                    @{m.username}
                  </span>
                ) : null}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>

        <FilterDropdown
          icon={CalendarClock}
          label="Due"
          activeCount={filters.due !== "any" ? 1 : 0}
          activeSummary={
            filters.due !== "any" ? TASK_DUE_FILTER_LABELS[filters.due] : null
          }
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Due date
          </DropdownMenuLabel>
          {TASK_DUE_FILTERS.map((preset) => (
            <DropdownMenuCheckboxItem
              key={preset}
              checked={filters.due === preset}
              onSelect={(event) => {
                event.preventDefault();
                setDue(preset);
              }}
            >
              {TASK_DUE_FILTER_LABELS[preset]}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>

        {activeCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearAll}
            className="ml-auto h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <X className="size-3" />
            Clear ({activeCount})
          </Button>
        ) : (
          <span className="ml-auto text-[11px] text-zinc-500">
            No filters
          </span>
        )}
      </div>

      <Summary
        matched={matchedCount}
        overdue={overdueCount}
        done={doneCount}
        active={activeCount > 0}
      />
    </section>
  );
}

/* ─── building blocks ─────────────────────────────── */

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Local controlled state so typing feels instant; we only push the
  // committed value upstream after a brief idle window. Using a ref
  // for the timer to avoid scheduling a setState on a stale closure.
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Externally-driven value changes (clear, browser back) should win.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const commit = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), 300);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
      <Input
        type="search"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          commit(next);
        }}
        placeholder="Search task titles…"
        className="h-7 w-52 bg-white/[0.02] pl-7 text-xs"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function FilterDropdown({
  icon: Icon,
  label,
  activeCount,
  activeSummary,
  children,
}: {
  icon: typeof Filter;
  label: string;
  activeCount: number;
  activeSummary: string | null;
  children: React.ReactNode;
}) {
  // The trigger reads as a sentence: `Status: To-do, In Progress`.
  // Falling back to a neutral grey when nothing is picked keeps the
  // bar visually quiet by default and lights up only what the user
  // has actually constrained.
  const isActive = activeCount > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
            isActive
              ? "border-white/15 bg-white/[0.06] text-zinc-100"
              : "border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]",
          )}
        >
          <Icon className="size-3" />
          <span>{label}</span>
          {activeSummary ? (
            <span className="max-w-[140px] truncate text-zinc-400">
              · {activeSummary}
            </span>
          ) : null}
          {activeCount > 1 ? (
            <span className="rounded bg-white/10 px-1 text-[10px] font-medium text-zinc-200">
              {activeCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Summary({
  matched,
  overdue,
  done,
  active,
}: {
  matched: number;
  overdue: number;
  done: number;
  active: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
      <span>
        <span className="font-medium text-zinc-200 tabular-nums">
          {matched}
        </span>{" "}
        {matched === 1 ? "task" : "tasks"}
        {active ? " match" : ""}
      </span>
      {overdue > 0 ? (
        <span>
          <span className="font-medium text-red-300 tabular-nums">
            {overdue}
          </span>{" "}
          overdue
        </span>
      ) : null}
      {done > 0 ? (
        <span>
          <span className="font-medium text-emerald-300 tabular-nums">
            {done}
          </span>{" "}
          done
        </span>
      ) : null}
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────── */

function summariseTokens<T extends string>(
  tokens: T[],
  toLabel: (t: T) => string,
): string | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return toLabel(tokens[0]);
  if (tokens.length === 2) return `${toLabel(tokens[0])}, ${toLabel(tokens[1])}`;
  return `${toLabel(tokens[0])} +${tokens.length - 1}`;
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
