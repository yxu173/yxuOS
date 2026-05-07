"use client";

import { Check, Plus, UserPlus } from "lucide-react";
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
}

const UNASSIGNED = "__unassigned__";

/**
 * Linear-style create-task overlay. Big title input is the focus; the
 * description supports markdown + image upload via the shared
 * `MarkdownEditor`. Status / priority / assignee live as inline pills at
 * the bottom — clicking each opens its picker.
 */
export function CreateTaskDialog({
  members,
  parentTaskId,
  triggerLabel,
  inline = false,
}: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
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
        await createTask({
          title: trimmed,
          description: description.trim() || null,
          status,
          priority,
          assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
          parentTaskId: parentTaskId ?? null,
        });
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
        className="flex max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <form onSubmit={submit} className="flex flex-col">
          {/* Crumb / context line — also serves as the dialog's accessible
              title. The visual styling is intentionally muted because the
              big title input below is the real focus, but the heading
              still needs to exist for screen readers. */}
          <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <DialogTitle className="text-xs font-normal uppercase tracking-wide text-zinc-500">
              {parentTaskId ? "New sub-task" : "New task"}
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
          </header>
          <DialogDescription className="sr-only">
            {parentTaskId
              ? "Add a sub-task. Sub-tasks roll up to their parent and have their own status, priority, and assignee."
              : "Create a task scoped to the active team. Add details now or fill them in later."}
          </DialogDescription>

          {/* Title — borderless, big */}
          <div className="px-5 pt-4">
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              maxLength={200}
              required
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter"
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="w-full bg-transparent text-lg font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          {/* Description — WYSIWYG rich text editor with inline image upload */}
          <div
            className="px-5 pb-1 pt-2"
            onKeyDownCapture={(event) => {
              // ⌘⏎ submits the form regardless of where the focus is — TipTap
              // would otherwise capture the keypress.
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter"
              ) {
                event.preventDefault();
                submit();
              }
            }}
          >
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Add a description… paste / drop images to drop them inline."
              maxBodyHeight={320}
            />
          </div>

          {/* Inline property pills */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 px-5 py-3">
            <StatusDropdown status={status} onChange={setStatus} />
            <PriorityDropdown
              priority={priority}
              onChange={setPriority}
            />
            <AssigneeDropdown
              assignee={assignedMember}
              members={members}
              onChange={(next) =>
                setAssigneeId(next?.userId ?? UNASSIGNED)
              }
            />
          </div>

          {error ? (
            <p className="px-5 pb-2 text-sm text-destructive">{error}</p>
          ) : null}

          <footer className="flex items-center justify-end gap-2 border-t border-white/5 bg-white/[0.02] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
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

/* ─── local-only pickers (don't hit the server while we're still in the create form) ─── */

function StatusDropdown({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (next: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-white/10"
        >
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

function AssigneeDropdown({
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
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-white/10"
        >
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

function PriorityDropdown({
  priority,
  onChange,
}: {
  priority: TaskPriority;
  onChange: (next: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-white/10",
          )}
        >
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
