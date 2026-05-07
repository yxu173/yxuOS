"use client";

import {
  ChevronDown,
  ChevronRight,
  FolderPen,
  FolderPlus,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";

import {
  deleteBoardFolder,
  renameBoardFolder,
} from "@/app/(app)/boards/folder-actions";
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

export interface FolderActionsMenuProps {
  folderId: string;
  folderName: string;
  /** Click handler that opens the "create sub-folder" dialog tied to this folder. */
  onCreateChild: () => void;
}

export function FolderActionsMenu({
  folderId,
  folderName,
  onCreateChild,
}: FolderActionsMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(folderName);
  const [renamePending, startRename] = useTransition();
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();

  const submitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === folderName) {
      setRenameOpen(false);
      return;
    }
    startRename(async () => {
      try {
        await renameBoardFolder(folderId, trimmed);
        setRenameOpen(false);
        setRenameError(null);
      } catch (err) {
        setRenameError(
          err instanceof Error ? err.message : "Failed to rename folder",
        );
      }
    });
  };

  const submitDelete = () => {
    startDelete(async () => {
      try {
        await deleteBoardFolder(folderId);
        setDeleteOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete folder");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${folderName}`}
            className="opacity-0 transition-opacity group-hover/folder:opacity-100 focus-visible:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onCreateChild();
            }}
          >
            <FolderPlus className="size-3.5" />
            New sub-folder
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setDraftName(folderName);
              setRenameError(null);
              setRenameOpen(true);
            }}
          >
            <FolderPen className="size-3.5" />
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
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Pick a new name for this folder.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-2">
              <Label htmlFor={`folder-rename-${folderId}`}>Name</Label>
              <Input
                id={`folder-rename-${folderId}`}
                value={draftName}
                autoFocus
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
            <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{folderName}</span>{" "}
              and any sub-folders inside it will be removed. Boards inside
              the folder are preserved — they move back to the project root.
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
              {deletePending ? "Deleting…" : "Delete folder"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolderId: string | null;
  parentFolderName: string | null;
  /** Server action that creates the folder. */
  onSubmit: (name: string) => Promise<void>;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentFolderName,
  onSubmit,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await onSubmit(trimmed);
        setName("");
        setError(null);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create folder");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {parentFolderName ? "New sub-folder" : "New folder"}
          </DialogTitle>
          <DialogDescription>
            {parentFolderName
              ? `Inside "${parentFolderName}".`
              : "Top-level folder in this project."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Architecture"
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* re-export for convenience */
export { ChevronDown, ChevronRight };
