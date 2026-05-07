"use client";

import {
  ArrowRight,
  FolderOutput,
  MoreHorizontal,
  PencilLine,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { deleteBoard, renameBoard } from "@/app/(app)/boards/actions";
import { moveBoardToFolder } from "@/app/(app)/boards/folder-actions";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { FolderTreeBoard } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface FolderOption {
  id: string;
  name: string;
  /** Indentation level so the menu shows nesting visually. */
  depth: number;
}

export interface BoardCardProps {
  board: FolderTreeBoard;
  /** Active folder for this card — null when the board sits at the project root. */
  currentFolderId: string | null;
  hrefBase: string;
  /** Flat list of every folder in the project, with depth — used for the "Move to" submenu. */
  allFolders: FolderOption[];
}

export function BoardCardInFolder({
  board,
  currentFolderId,
  hrefBase,
  allFolders,
}: BoardCardProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState(board.name);
  const [renamePending, startRename] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const [movePending, startMove] = useTransition();

  const submitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === board.name) {
      setRenameOpen(false);
      return;
    }
    startRename(async () => {
      try {
        await renameBoard(board.id, trimmed);
        setRenameOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to rename");
      }
    });
  };

  const submitDelete = () => {
    startDelete(async () => {
      try {
        await deleteBoard(board.id);
        setDeleteOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  };

  const moveTo = (folderId: string | null) => {
    startMove(async () => {
      try {
        await moveBoardToFolder(board.id, folderId);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to move");
      }
    });
  };

  return (
    <>
      <div className="group/board relative flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
        <Link
          href={`${hrefBase}/${board.id}`}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
        >
          <span className="truncate text-zinc-100">{board.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {dateFormatter.format(board.updatedAt)}
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${board.name}`}
              disabled={renamePending || deletePending || movePending}
              className="opacity-0 transition-opacity group-hover/board:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`${hrefBase}/${board.id}`} className="w-full">
                <ArrowRight className="size-3.5" />
                Open
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setDraft(board.name);
                setRenameOpen(true);
              }}
            >
              <PencilLine className="size-3.5" />
              Rename
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderOutput className="size-3.5" />
                Move to…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Move to folder
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => moveTo(null)}
                  disabled={currentFolderId === null}
                >
                  Project root
                </DropdownMenuItem>
                {allFolders.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    {allFolders.map((folder) => (
                      <DropdownMenuItem
                        key={folder.id}
                        onSelect={() => moveTo(folder.id)}
                        disabled={folder.id === currentFolderId}
                        style={{ paddingLeft: 8 + folder.depth * 12 }}
                      >
                        {folder.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>
              Give this board a new name.
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
              <Label htmlFor={`board-rename-${board.id}`}>Name</Label>
              <Input
                id={`board-rename-${board.id}`}
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={renamePending}
              />
            </div>
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
                disabled={renamePending || !draft.trim()}
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
            <AlertDialogTitle>Delete this board?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{board.name}</span>{" "}
              and its chat history will be permanently removed. This
              can&apos;t be undone.
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
