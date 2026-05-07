"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export interface CreateTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SLUG_MAX = 30;

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

/**
 * Create-team modal. Calls the Better Auth organization plugin client to
 * create the org (the plugin auto-adds the creator as owner) then sets the
 * new team active and refreshes the page.
 */
export function CreateTeamDialog({ open, onOpenChange }: CreateTeamDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
  };

  const handleNameChange = (next: string) => {
    setName(next);
    if (!slugTouched) setSlug(toSlug(next));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Team name is required");
      return;
    }
    const finalSlug = slug.trim() ? toSlug(slug) : toSlug(trimmedName);
    if (!finalSlug) {
      setError("Pick a slug with at least one letter or number");
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await authClient.organization.create({
        name: trimmedName,
        slug: finalSlug,
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to create team");
        return;
      }
      const newId = result.data?.id;
      if (newId) {
        await authClient.organization.setActive({ organizationId: newId });
      }
      onOpenChange(false);
      reset();
      // Land on the boards index of the new (empty) team.
      router.push("/boards");
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a team</DialogTitle>
            <DialogDescription>
              Teams are shared workspaces. Anyone you add gets full access to
              all boards and designs in the team.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                autoFocus
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Acme Corp"
                maxLength={60}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="team-slug">Slug</Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(toSlug(event.target.value));
                }}
                placeholder="acme-corp"
                maxLength={SLUG_MAX}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens. Must be unique.
              </p>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
