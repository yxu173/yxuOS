"use client";

import { useState, useTransition } from "react";

import { createProject } from "@/lib/projects";
import { toProjectSlug } from "@/lib/slug";
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
import { cn } from "@/lib/utils";

const COLOR_PRESETS: Array<{ value: string; label: string }> = [
  { value: "rgb(63 63 70)", label: "Slate" },
  { value: "rgb(99 102 241)", label: "Indigo" },
  { value: "rgb(20 184 166)", label: "Teal" },
  { value: "rgb(217 70 239)", label: "Fuchsia" },
  { value: "rgb(245 158 11)", label: "Amber" },
  { value: "rgb(244 63 94)", label: "Rose" },
  { value: "rgb(16 185 129)", label: "Emerald" },
];

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState<string>(COLOR_PRESETS[0]!.value);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setColor(COLOR_PRESETS[0]!.value);
    setError(null);
  };

  const onNameChange = (next: string) => {
    setName(next);
    if (!slugTouched) setSlug(toProjectSlug(next));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required");
      return;
    }
    const finalSlug = slug.trim()
      ? toProjectSlug(slug)
      : toProjectSlug(trimmedName);
    if (!finalSlug) {
      setError("Pick a slug with at least one letter or number");
      return;
    }

    startTransition(async () => {
      try {
        // `createProject` redirects on success — we won't get past this
        // line in the happy path. The catch only fires for errors.
        await createProject({
          name: trimmedName,
          slug: finalSlug,
          color,
        });
        onOpenChange(false);
        reset();
      } catch (err) {
        // Next.js's `redirect()` throws a `NEXT_REDIRECT` — re-throw so
        // the runtime picks it up. Any other error is surfaced inline.
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "Failed to create project");
      }
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
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Projects keep boards, designs, and tasks separated for one
              work-stream — like a product launch, a customer engagement,
              or an internal initiative.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                maxLength={80}
                placeholder="Acme website"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(toProjectSlug(event.target.value));
                }}
                maxLength={32}
                placeholder="acme-website"
              />
              <p className="text-[11px] text-muted-foreground">
                Used in URLs: <span className="font-mono">/p/{slug || "…"}</span>
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label>Accent</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {COLOR_PRESETS.map((preset) => {
                  const isActive = preset.value === color;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setColor(preset.value)}
                      title={preset.label}
                      className={cn(
                        "size-6 rounded-md border transition",
                        isActive
                          ? "border-zinc-100 ring-2 ring-zinc-100/40"
                          : "border-white/10 hover:border-white/30",
                      )}
                      style={{ backgroundColor: preset.value }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
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
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
