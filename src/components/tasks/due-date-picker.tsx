"use client";

import { Calendar, CalendarX2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { updateTask } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/utils";

export interface DueDatePickerProps {
  taskId: string;
  dueDate: Date | null;
}

const DATE_FMT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function toInputValue(date: Date | null): string {
  if (!date) return "";
  // Format as YYYY-MM-DD in the user's local timezone — `<input type=date>`
  // expects local-time strings.
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isOverdue(date: Date | null): boolean {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

export function DueDatePicker({ taskId, dueDate }: DueDatePickerProps) {
  const [optimistic, setOptimistic] = useState<Date | null | "noop">("noop");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = optimistic === "noop" ? dueDate : optimistic;

  // Reconcile our optimistic override with the server-shipped value
  // whenever the prop changes (revalidation post-action). Standard
  // optimistic-then-confirm sync — the lint rule's caution doesn't apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimistic("noop");
  }, [dueDate]);

  const save = (next: Date | null) => {
    setOptimistic(next);
    startTransition(async () => {
      try {
        await updateTask({ taskId, dueDate: next });
      } catch (err) {
        setOptimistic("noop");
        alert(
          err instanceof Error ? err.message : "Failed to update due date",
        );
      }
    });
  };

  const overdue = isOverdue(current);

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.showPicker?.()}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-white/5",
          pending && "opacity-70",
          current
            ? overdue
              ? "text-red-300"
              : "text-zinc-200"
            : "text-zinc-500",
        )}
      >
        <Calendar className="size-3.5" />
        {current ? DATE_FMT.format(current) : "No due date"}
      </button>
      {current ? (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-red-300"
          aria-label="Clear due date"
        >
          <CalendarX2 className="size-3" />
        </button>
      ) : null}
      {/* Hidden native picker — we use it for the calendar UI without
          rendering its default chrome. */}
      <input
        ref={inputRef}
        type="date"
        value={toInputValue(current)}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) {
            save(null);
            return;
          }
          const [y, m, d] = raw.split("-").map((part) => Number(part));
          const next = new Date(y, m - 1, d, 12, 0, 0, 0);
          save(next);
        }}
        className="absolute -z-10 size-0 opacity-0"
        tabIndex={-1}
      />
    </div>
  );
}
