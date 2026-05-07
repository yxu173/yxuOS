"use client";

import {
  Calendar,
  CalendarX2,
  Check,
  ChevronRight,
  Plus,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { createTask } from "@/app/(app)/tasks/actions";
import { RichTextEditor } from "@/components/markdown/rich-text-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export interface CreateTaskDialogProps {
  members: AssigneeOption[];
  /** Optional parent task — used by the subtask composer on the detail page. */
  parentTaskId?: string;
  /** Trigger override — defaults to a "New task" button. */
  triggerLabel?: string;
  /** When true, render the trigger as a small ghost button (used inside the subtasks list). */
  inline?: boolean;
  /** Project the task lands in. Defaults to the team's default project when unset. */
  projectSlug?: string;
}

const UNASSIGNED = "__unassigned__";

/**
 * Modern create-task overlay: a tight three-band layout (header → content
 * → footer) with the title input owning the heading slot, a flat
 * WYSIWYG editor in the middle, and the property pills + actions
 * pinned to the bottom edge. Visual cues match the rest of the app —
 * subtle white-on-zinc surfaces, soft borders, no heavy chrome.
 */
export function CreateTaskDialog({
  members,
  parentTaskId,
  triggerLabel,
  inline = false,
  projectSlug,
}: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  const reset = () => {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("medium");
    setAssigneeId(UNASSIGNED);
    setDueDate(null);
    setError(null);
  };

  const submit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      titleRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        await createTask(
          {
            title: trimmed,
            description: description.trim() || null,
            status,
            priority,
            assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
            parentTaskId: parentTaskId ?? null,
            dueDate,
          },
          projectSlug,
        );
        setOpen(false);
        reset();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create task");
      }
    });
  };

  const assignedMember = members.find((m) => m.userId === assigneeId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size={inline ? "sm" : "default"}
          variant={inline ? "ghost" : "default"}
          className="gap-1.5"
        >
          <Plus className="size-4" />
          {triggerLabel ?? (parentTaskId ? "New sub-task" : "New task")}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <form
          onSubmit={submit}
          className="flex flex-col"
          onKeyDownCapture={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter"
            ) {
              event.preventDefault();
              submit();
            }
          }}
        >
          {/* Tiny breadcrumb header — replaces the previous all-caps strip
              with something that fits the rest of the chrome. */}
          <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-1">
            <DialogTitle className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <Sparkles className="size-3 text-zinc-500" />
              {parentTaskId ? "Sub-task" : "New task"}
              <ChevronRight className="size-3 text-zinc-700" />
              <span className="text-zinc-500">draft</span>
            </DialogTitle>
            <span className="text-[10px] text-zinc-500">
              <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
                ⌘
              </kbd>{" "}
              <kbd className="rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[10px] text-zinc-300">
                ⏎
              </kbd>
              {" to create"}
            </span>
          </div>
          <DialogDescription className="sr-only">
            {parentTaskId
              ? "Add a sub-task. Sub-tasks roll up to their parent and have their own status, priority, and assignee."
              : "Create a task scoped to the active team. Add details now or fill them in later."}
          </DialogDescription>

          {/* Title — borderless, large; doubles as the visual heading. */}
          <div className="px-6 pt-2">
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              maxLength={200}
              required
              className="w-full bg-transparent text-2xl font-semibold tracking-tight text-zinc-50 placeholder:text-zinc-700 focus:outline-none"
            />
          </div>

          {/* Description — WYSIWYG editor, takes the rest of the body. */}
          <div className="flex flex-col gap-3 px-6 pt-3 pb-4">
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Add a description… paste or drop images to drop them inline."
              maxBodyHeight={320}
            />
          </div>

          {/* Property pills row */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 bg-white/[0.015] px-6 py-3">
            <StatusPill status={status} onChange={setStatus} />
            <PriorityPill priority={priority} onChange={setPriority} />
            <AssigneePill
              assignee={assignedMember}
              members={members}
              onChange={(next) =>
                setAssigneeId(next?.userId ?? UNASSIGNED)
              }
            />
            <DueDatePill dueDate={dueDate} onChange={setDueDate} />
          </div>

          {error ? (
            <p className="border-t border-red-500/20 bg-red-500/5 px-6 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <footer className="flex items-center justify-end gap-2 border-t border-white/5 bg-zinc-950/40 px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || !title.trim()}
            >
              {pending
                ? "Creating…"
                : parentTaskId
                  ? "Create sub-task"
                  : "Create task"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── pill primitives ─────────────────────────────── */

const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-200 transition-colors hover:border-white/15 hover:bg-white/[0.08]";

function StatusPill({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (next: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={PILL_CLASS}>
          <StatusIcon status={status} />
          {TASK_STATUS_LABELS[status]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Status
        </DropdownMenuLabel>
        {TASK_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <StatusIcon status={option} />
              {TASK_STATUS_LABELS[option]}
            </span>
            {option === status ? (
              <Check className="size-3.5 text-zinc-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityPill({
  priority,
  onChange,
}: {
  priority: TaskPriority;
  onChange: (next: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={PILL_CLASS}>
          <PriorityIcon priority={priority} />
          {TASK_PRIORITY_LABELS[priority]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Priority
        </DropdownMenuLabel>
        {[...TASK_PRIORITIES].reverse().map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <PriorityIcon priority={option} />
              {TASK_PRIORITY_LABELS[option]}
            </span>
            {option === priority ? (
              <Check className="size-3.5 text-zinc-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneePill({
  assignee,
  members,
  onChange,
}: {
  assignee: AssigneeOption | null;
  members: AssigneeOption[];
  onChange: (next: AssigneeOption | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={PILL_CLASS}>
          {assignee ? (
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-zinc-800 text-[8px] font-semibold text-zinc-200">
              {initials(assignee.name)}
            </span>
          ) : (
            <UserPlus className="size-3.5 text-zinc-500" />
          )}
          {assignee?.name ?? "Unassigned"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Assign to
        </DropdownMenuLabel>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.userId}
            onSelect={() => onChange(m)}
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
            {m.userId === assignee?.userId ? (
              <Check className="size-3.5 text-zinc-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {assignee ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onChange(null)}
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

const DUE_FMT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

function toInputValue(date: Date | null): string {
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function DueDatePill({
  dueDate,
  onChange,
}: {
  dueDate: Date | null;
  onChange: (next: Date | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <span className={cn("relative", PILL_CLASS, "p-0")}>
      <button
        type="button"
        onClick={() => inputRef.current?.showPicker?.()}
        className="inline-flex items-center gap-1.5 px-2 py-1"
      >
        <Calendar className="size-3.5 text-zinc-500" />
        {dueDate ? DUE_FMT.format(dueDate) : "No due date"}
      </button>
      {dueDate ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-0.5 grid size-5 place-items-center rounded text-zinc-500 transition-colors hover:bg-white/10 hover:text-red-300"
          aria-label="Clear due date"
        >
          <CalendarX2 className="size-3" />
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="date"
        value={toInputValue(dueDate)}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) {
            onChange(null);
            return;
          }
          const [y, m, d] = raw.split("-").map((part) => Number(part));
          onChange(new Date(y, m - 1, d, 12, 0, 0, 0));
        }}
        className="absolute -z-10 size-0 opacity-0"
        tabIndex={-1}
      />
    </span>
  );
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
