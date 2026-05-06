"use client";

import { Boxes, Library, MoreHorizontal, Trash2 } from "lucide-react";
import { useTransition } from "react";

import {
  deleteDesignComponent,
  renameDesignComponent,
} from "@/app/(app)/designs/component-actions";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

import { useComponentLibrary } from "./component-library-context";

/**
 * Library tab in the right panel. Lists the user's saved components,
 * with rename / delete affordances. Component creation happens from the
 * Inspector ("Save selection as component") — no manual JSON entry yet.
 */
export function LibraryPanel() {
  const { list } = useComponentLibrary();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          <Library className="size-3" />
          {list.length} component{list.length === 1 ? "" : "s"}
        </span>
      </div>

      <ScrollArea className="flex-1">
        {list.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {list.map((component) => (
              <LibraryRow key={component.id} component={component} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center text-xs text-zinc-500">
      <div className="flex flex-col items-center gap-3">
        <Boxes className="size-8 text-zinc-600" />
        <div>
          <p className="text-zinc-300">No saved components yet.</p>
          <p className="mt-1.5 text-[11px] leading-relaxed">
            Click any element on a design and pick{" "}
            <span className="font-medium text-zinc-300">
              Save as component
            </span>{" "}
            in the inspector. Saved components are reusable across all your
            designs and the agent can drop them in by name.
          </p>
        </div>
      </div>
    </div>
  );
}

function LibraryRow({
  component,
}: {
  component: { id: string; name: string; slug: string };
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftName, setDraftName] = useState(component.name);
  const [pending, startTransition] = useTransition();

  const submitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === component.name) {
      setRenameOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await renameDesignComponent(component.id, trimmed);
      } finally {
        setRenameOpen(false);
      }
    });
  };

  const submitDelete = () => {
    startTransition(async () => {
      try {
        await deleteDesignComponent(component.id);
      } finally {
        setDeleteOpen(false);
      }
    });
  };

  return (
    <li className="group flex items-center justify-between gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 transition-colors hover:bg-white/[0.04]">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-zinc-100">{component.name}</span>
        <span className="truncate font-mono text-[10px] text-zinc-500">
          {component.slug}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${component.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setDraftName(component.name);
              setRenameOpen(true);
            }}
          >
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

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename component</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-2">
              <Label htmlFor={`rename-comp-${component.id}`}>Name</Label>
              <Input
                id={`rename-comp-${component.id}`}
                value={draftName}
                autoFocus
                onChange={(event) => setDraftName(event.target.value)}
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
              <Button type="submit" disabled={pending || !draftName.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this component?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">
                {component.name}
              </span>{" "}
              will be removed from your library. Existing designs that
              reference it will show a missing-component placeholder until
              the references are removed or the agent regenerates them.
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
    </li>
  );
}
