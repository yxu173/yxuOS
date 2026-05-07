"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteTeam, renameTeam } from "@/app/(app)/teams/[teamId]/actions";
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
import { authClient } from "@/lib/auth-client";

export interface TeamSettingsFormProps {
  teamId: string;
  initialName: string;
  /** True when this is the user's auto-created personal team. */
  isPersonal: boolean;
}

export function TeamSettingsForm({
  teamId,
  initialName,
  isPersonal,
}: TeamSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const trimmed = name.trim();
  const dirty = trimmed !== initialName.trim();
  const canSave = !pending && dirty && trimmed.length > 0 && !isPersonal;

  const handleRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!canSave) return;
    startTransition(async () => {
      try {
        await renameTeam(teamId, trimmed);
        setInfo("Team renamed");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename team");
      }
    });
  };

  const handleDelete = () => {
    setDeleteError(null);
    if (confirmText.trim() !== initialName.trim()) {
      setDeleteError("Type the team name exactly to confirm");
      return;
    }
    startTransition(async () => {
      try {
        const { fallbackTeamId } = await deleteTeam(teamId, confirmText);
        // Switch active team so the next page load lands somewhere valid.
        await authClient.organization.setActive({
          organizationId: fallbackTeamId,
        });
        setConfirmOpen(false);
        router.push("/boards");
        router.refresh();
      } catch (err) {
        setDeleteError(
          err instanceof Error ? err.message : "Failed to delete team",
        );
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Rename */}
      <form onSubmit={handleRename} className="flex flex-col gap-3">
        <div className="grid gap-2">
          <Label htmlFor="team-rename">Team name</Label>
          <Input
            id="team-rename"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            disabled={pending || isPersonal}
            required
          />
          {isPersonal ? (
            <p className="text-xs text-muted-foreground">
              Personal teams keep their name to make them easy to spot in the
              switcher.
            </p>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {info ? <p className="text-sm text-emerald-400">{info}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSave}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      {/* Danger zone */}
      <div className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-red-200">Danger zone</h3>
          <p className="text-xs text-red-300/70">
            {isPersonal
              ? "Personal teams can't be deleted — they're your fallback workspace."
              : "Deleting a team permanently removes every board, design, component, and asset in it. This can't be undone."}
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100"
            onClick={() => {
              setConfirmText("");
              setDeleteError(null);
              setConfirmOpen(true);
            }}
            disabled={isPersonal}
          >
            Delete team
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmText("");
            setDeleteError(null);
          }
          setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {initialName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every board, design, component, and asset in this team will be
              permanently removed. Members will lose access immediately. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="confirm-team-name">
              Type{" "}
              <span className="font-mono text-zinc-100">{initialName}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-team-name"
              value={confirmText}
              onChange={(event) => {
                setConfirmText(event.target.value);
                setDeleteError(null);
              }}
              autoComplete="off"
              autoCapitalize="off"
              disabled={pending}
            />
            {deleteError ? (
              <p className="text-xs text-destructive">{deleteError}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={pending || confirmText.trim() !== initialName.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              {pending ? "Deleting…" : "Delete team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
