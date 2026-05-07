"use client";

import { MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

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
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface WorkspaceCreator {
  name: string;
  /** Lowercase handle (the `username` column on the user table). */
  username: string | null;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  updatedAt: Date;
  /** The user who first created this item. Optional so older callers still type-check. */
  creator?: WorkspaceCreator | null;
}

export interface WorkspaceCardProps {
  item: WorkspaceItem;
  /** URL base; the link target is `${hrefBase}/${item.id}`. */
  hrefBase: string;
  /** Singular label ("board", "design") for human-facing strings. */
  itemLabel: string;
  /** Server action that renames the item. */
  renameAction: (id: string, name: string) => Promise<void>;
  /** Server action that deletes the item. */
  deleteAction: (id: string) => Promise<void>;
}

export function WorkspaceCard({
  item,
  hrefBase,
  itemLabel,
  renameAction,
  deleteAction,
}: WorkspaceCardProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [pending, startTransition] = useTransition();

  const submitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === item.name) {
      setRenameOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await renameAction(item.id, trimmed);
      } finally {
        setRenameOpen(false);
      }
    });
  };

  const submitDelete = () => {
    startTransition(async () => {
      try {
        await deleteAction(item.id);
      } finally {
        setDeleteOpen(false);
      }
    });
  };

  return (
    <>
      <div className="group relative">
        <Link
          href={`${hrefBase}/${item.id}`}
          className="block focus-visible:outline-none"
        >
          <Card className="h-32 transition-colors group-hover:border-foreground/30 group-focus-visible:border-foreground/40">
            <CardHeader>
              <CardTitle className="truncate text-base">{item.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Updated {dateFormatter.format(item.updatedAt)}
              </p>
              {item.creator ? (
                <p className="mt-1 truncate text-xs text-muted-foreground/70">
                  by{" "}
                  <span className="text-zinc-400">
                    {item.creator.username
                      ? `@${item.creator.username}`
                      : item.creator.name}
                  </span>
                </p>
              ) : null}
            </CardHeader>
          </Card>
        </Link>

        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${item.name}`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setDraft(item.name);
                  setRenameOpen(true);
                }}
              >
                <PencilLine className="size-3.5" />
                Rename
              </DropdownMenuItem>
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
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename {itemLabel}</DialogTitle>
            <DialogDescription>
              Give this {itemLabel} a new name.
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
              <Label htmlFor={`rename-${item.id}`}>Name</Label>
              <Input
                id={`rename-${item.id}`}
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                disabled={pending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draft.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {itemLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{item.name}</span>{" "}
              and its chat history will be permanently removed. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                submitDelete();
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
