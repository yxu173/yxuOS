"use client";

import { Check, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";

import { updateTask } from "@/app/(app)/tasks/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface AssigneeOption {
  userId: string;
  name: string;
  username: string | null;
}

export interface AssigneePickerProps {
  taskId: string;
  assignee: AssigneeOption | null;
  members: AssigneeOption[];
  /** Compact (avatar-only) mode used in tight rows. Default false renders the name too. */
  compact?: boolean;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function AssigneePicker({
  taskId,
  assignee,
  members,
  compact = false,
}: AssigneePickerProps) {
  const [optimistic, setOptimistic] = useState<AssigneeOption | null | "noop">(
    "noop",
  );
  const [pending, startTransition] = useTransition();
  const current = optimistic === "noop" ? assignee : optimistic;

  const setAssignee = (next: AssigneeOption | null) => {
    if ((next?.userId ?? null) === (current?.userId ?? null)) return;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await updateTask({
          taskId,
          assigneeId: next?.userId ?? null,
        });
      } catch (err) {
        setOptimistic("noop");
        alert(err instanceof Error ? err.message : "Failed to assign");
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
          aria-label={current ? `Assignee: ${current.name}` : "Unassigned"}
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
        >
          {current ? (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200">
              {initials(current.name)}
            </span>
          ) : (
            <UserPlus className="size-3.5 text-zinc-500" />
          )}
          {!compact ? (
            <span className="truncate text-zinc-300">
              {current?.name ?? "Unassigned"}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Assign to
        </DropdownMenuLabel>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.userId}
            onSelect={() => setAssignee(m)}
            className="justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-200">
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
            </span>
            {m.userId === current?.userId ? (
              <Check className="size-3.5 text-zinc-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setAssignee(null)}
              className="text-zinc-400 focus:text-zinc-200"
            >
              Unassign
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
