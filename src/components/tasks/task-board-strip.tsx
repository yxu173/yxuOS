"use client";

import { Layers, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import {
  createTaskBoard,
  deleteTaskBoard,
  renameTaskBoard,
  type TaskBoardRow,
} from "@/app/(app)/tasks/board-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface TaskBoardStripProps {
  boards: TaskBoardRow[];
  /** Slug of the active project — bound to create-board calls. */
  projectSlug: string;
  /** Currently-active board id, or null = the "All tasks" tab. */
  activeBoardId: string | null;
}

/**
 * Horizontal pill strip on the tasks index for switching between task
 * boards. The leftmost pill is always the cross-board "All tasks" view;
 * one pill follows for each task board, plus a "+ New" trigger at the
 * end.
 */
export function TaskBoardStrip({
  boards,
  projectSlug,
  activeBoardId,
}: TaskBoardStripProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPending, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = createName.trim();
    if (!trimmed) return;
    startCreate(async () => {
      try {
        await createTaskBoard({ projectSlug, name: trimmed });
        setCreateName("");
        setCreateError(null);
        setCreateOpen(false);
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Failed to create board",
        );
      }
    });
  };

  const allHref = `/p/${projectSlug}/tasks`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
        <Link
          href={allHref}
          aria-current={activeBoardId === null ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            activeBoardId === null
              ? "bg-white/10 text-zinc-50"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
          )}
        >
          <Layers className="size-3" />
          All tasks
        </Link>

        {boards.map((board) => (
          <TaskBoardPill
            key={board.id}
            board={board}
            projectSlug={projectSlug}
            isActive={board.id === activeBoardId}
          />
        ))}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setCreateOpen(true)}
          className="h-7 gap-1 px-2 text-xs"
        >
          <Plus className="size-3" />
          New board
        </Button>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) {
            setCreateName("");
            setCreateError(null);
          }
          setCreateOpen(next);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New task board</DialogTitle>
            <DialogDescription>
              Use task boards for sprints, kanban swimlanes, or recurring
              project work-streams.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="flex flex-col gap-3">
            <div className="grid gap-2">
              <Label htmlFor="new-task-board-name">Name</Label>
              <Input
                id="new-task-board-name"
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Sprint 24"
                maxLength={80}
                required
              />
            </div>
            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
                disabled={createPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createPending || !createName.trim()}
              >
                {createPending ? "Creating…" : "Create board"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskBoardPill({
  board,
  projectSlug,
  isActive,
}: {
  board: TaskBoardRow;
  projectSlug: string;
  isActive: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(board.name);
  const [renamePending, startRename] = useTransition();
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();

  const submitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === board.name) {
      setRenameOpen(false);
      return;
    }
    startRename(async () => {
      try {
        await renameTaskBoard(board.id, trimmed);
        setRenameOpen(false);
        setRenameError(null);
      } catch (err) {
        setRenameError(
          err instanceof Error ? err.message : "Failed to rename board",
        );
      }
    });
  };

  const submitDelete = () => {
    startDelete(async () => {
      try {
        await deleteTaskBoard(board.id);
        setDeleteOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  };

  return (
    <div className="group relative inline-flex items-center">
      <Link
        href={`/p/${projectSlug}/tasks?board=${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1 text-xs font-medium transition-colors",
          isActive
            ? "bg-white/10 text-zinc-50"
            : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
        )}
      >
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: board.color ?? "rgb(113 113 122)" }}
        />
        {board.name}
        <span className="text-[10px] tabular-nums text-zinc-500">
          {board.taskCount}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              aria-label={`Actions for ${board.name}`}
              className={cn(
                "ml-1 grid size-5 place-items-center rounded transition-colors hover:bg-white/10",
                isActive ? "text-zinc-300" : "text-zinc-500",
              )}
            >
              <MoreHorizontal className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setDraftName(board.name);
                setRenameError(null);
                setRenameOpen(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-3.5" />
              Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Link>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename task board</DialogTitle>
            <DialogDescription>
              Pick a new name. Tasks already in this board stay put.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-2">
              <Label htmlFor={`task-board-rename-${board.id}`}>Name</Label>
              <Input
                id={`task-board-rename-${board.id}`}
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={renamePending}
                maxLength={80}
              />
            </div>
            {renameError ? (
              <p className="text-sm text-destructive">{renameError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
                disabled={renamePending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={renamePending || !draftName.trim()}
              >
                {renamePending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task board?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{board.name}</span>{" "}
              will be removed. Tasks inside it move to the project&apos;s
              backlog (the &quot;All tasks&quot; view) and can be reassigned
              to another board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                submitDelete();
              }}
              disabled={deletePending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletePending ? "Deleting…" : "Delete board"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
