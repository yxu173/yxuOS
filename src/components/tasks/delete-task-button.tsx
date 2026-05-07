"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteTask } from "@/app/(app)/tasks/actions";
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

export interface DeleteTaskButtonProps {
  taskId: string;
  taskTitle: string;
  /** Where to navigate after a successful delete. Defaults to /tasks. */
  redirectTo?: string;
}

export function DeleteTaskButton({
  taskId,
  taskTitle,
  redirectTo = "/tasks",
}: DeleteTaskButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      try {
        await deleteTask(taskId);
        setOpen(false);
        router.push(redirectTo);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete task");
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-zinc-500 hover:text-red-300"
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{taskTitle}</span>{" "}
              and all of its sub-tasks and comments will be permanently
              removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
              disabled={pending}
              className="bg-red-600 hover:bg-red-700"
            >
              {pending ? "Deleting…" : "Delete task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
