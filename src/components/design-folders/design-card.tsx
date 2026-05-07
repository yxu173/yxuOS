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

import { deleteDesign, renameDesign } from "@/app/(app)/designs/actions";
import { moveDesignToFolder } from "@/app/(app)/designs/folder-actions";
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

import type { DesignFolderTreeItem } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface DesignFolderOption {
  id: string;
  name: string;
  depth: number;
}

export interface DesignCardProps {
  design: DesignFolderTreeItem;
  currentFolderId: string | null;
  hrefBase: string;
  allFolders: DesignFolderOption[];
}

export function DesignCardInFolder({
  design,
  currentFolderId,
  hrefBase,
  allFolders,
}: DesignCardProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState(design.name);
  const [renamePending, startRename] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const [movePending, startMove] = useTransition();

  const submitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === design.name) {
      setRenameOpen(false);
      return;
    }
    startRename(async () => {
      try {
        await renameDesign(design.id, trimmed);
        setRenameOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to rename");
      }
    });
  };

  const submitDelete = () => {
    startDelete(async () => {
      try {
        await deleteDesign(design.id);
        setDeleteOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  };

  const moveTo = (folderId: string | null) => {
    startMove(async () => {
      try {
        await moveDesignToFolder(design.id, folderId);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to move");
      }
    });
  };

  return (
    <>
      <div className="group/design relative flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
        <Link
          href={`${hrefBase}/${design.id}`}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm"
        >
          <span className="truncate text-zinc-100">{design.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {dateFormatter.format(design.updatedAt)}
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${design.name}`}
              disabled={renamePending || deletePending || movePending}
              className="opacity-0 transition-opacity group-hover/design:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`${hrefBase}/${design.id}`} className="w-full">
                <ArrowRight className="size-3.5" />
                Open
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setDraft(design.name);
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
            <DialogTitle>Rename design</DialogTitle>
            <DialogDescription>
              Give this design a new name.
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
              <Label htmlFor={`design-rename-${design.id}`}>Name</Label>
              <Input
                id={`design-rename-${design.id}`}
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
            <AlertDialogTitle>Delete this design?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{design.name}</span>{" "}
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
