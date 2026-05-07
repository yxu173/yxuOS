"use client";

import { Check, ChevronsUpDown, FolderPlus, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectListItem } from "@/lib/projects";
import { cn } from "@/lib/utils";

import { CreateProjectDialog } from "./create-project-dialog";

export interface ProjectSwitcherProps {
  projects: ProjectListItem[];
  activeProjectSlug: string;
  /** Section we're currently in — used so switching project keeps you on the same surface (boards / designs / tasks). */
  activeSection?: "boards" | "designs" | "tasks";
}

/**
 * Picks among the active team's projects. Mirrors the team switcher in
 * the top bar — same shape, smaller scope. Switching projects keeps
 * you on the same section ("boards" → boards in the new project) so
 * navigation feels continuous.
 */
export function ProjectSwitcher({
  projects,
  activeProjectSlug,
  activeSection,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment();
  const [createOpen, setCreateOpen] = useState(false);

  // `activeSection` may be undefined on pages outside the project surface
  // (the project settings page itself, eventual archived view, etc.).
  // Fall back to whatever the next route segment after [projectSlug] is.
  const fallbackSection = segment === null ? undefined : segment;
  const section = activeSection ?? fallbackSection ?? "boards";

  const active =
    projects.find((p) => p.slug === activeProjectSlug) ?? projects[0];

  const switchTo = (slug: string) => {
    if (slug === activeProjectSlug) return;
    router.push(`/p/${slug}/${section}`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-sm font-medium text-zinc-200 hover:bg-white/5"
            aria-label="Switch project"
          >
            <span
              className="grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold text-zinc-200"
              style={{
                backgroundColor: active?.color ?? "rgb(63 63 70)",
              }}
            >
              {(active?.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-32 truncate">
              {active?.name ?? "No project"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-zinc-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Projects
          </DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => switchTo(project.slug)}
              className="justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold text-zinc-200"
                  style={{
                    backgroundColor: project.color ?? "rgb(63 63 70)",
                  }}
                >
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{project.name}</span>
              </span>
              {project.slug === activeProjectSlug ? (
                <Check className="size-3.5 text-zinc-300" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {active ? (
            <DropdownMenuItem asChild>
              <Link
                href={`/p/${active.slug}/settings`}
                className={cn("w-full")}
              >
                <Settings className="size-3.5" />
                Project settings
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreateOpen(true);
            }}
          >
            <FolderPlus className="size-3.5" />
            New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
