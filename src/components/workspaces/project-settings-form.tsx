"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { archiveProject, renameProject } from "@/lib/projects";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProjectSettingsFormProps {
  projectId: string;
  projectSlug: string;
  initialName: string;
}

export function ProjectSettingsForm({
  projectId,
  projectSlug,
  initialName,
}: ProjectSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, startTransition] = useTransition();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const dirty = name.trim() !== initialName.trim();

  const onRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await renameProject(projectId, trimmed);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to rename");
      }
    });
  };

  const onArchive = () => {
    setArchiveError(null);
    startTransition(async () => {
      try {
        await archiveProject(projectId);
        setArchiveOpen(false);
        // Land on the home dashboard so we don't stay on a now-archived URL.
        router.push("/");
        router.refresh();
      } catch (err) {
        setArchiveError(
          err instanceof Error ? err.message : "Failed to archive",
        );
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-zinc-100">Profile</h2>
          <p className="text-xs text-muted-foreground">
            Slug is locked once a project exists — links rely on it. Spin
            up a new project if you need a different slug.
          </p>
        </div>
        <form onSubmit={onRename} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-slug">Slug</Label>
            <Input
              id="project-slug"
              value={projectSlug}
              readOnly
              disabled
              className="cursor-not-allowed text-muted-foreground"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-red-200">Archive project</h2>
          <p className="text-xs text-red-300/70">
            Hides the project from the switcher and home dashboard. Boards,
            designs, and tasks stay intact and can be restored by an admin
            via SQL until we ship the un-archive UI.
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100"
            onClick={() => setArchiveOpen(true)}
          >
            Archive project
          </Button>
        </div>
      </section>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {initialName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project disappears from the switcher and home dashboard.
              Anyone with a deep link to one of its boards / designs / tasks
              will hit a 404.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? (
            <p className="text-sm text-red-300">{archiveError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onArchive();
              }}
              disabled={pending}
              className="bg-red-600 hover:bg-red-700"
            >
              {pending ? "Archiving…" : "Archive project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
