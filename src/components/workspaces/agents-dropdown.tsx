"use client";

import {
  Brain,
  ChevronDown,
  ClipboardList,
  Microscope,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

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
import type { ProjectListItem } from "@/lib/projects";
import { cn } from "@/lib/utils";

/**
 * "Agents▾" dropdown — entry point for Research and Plans.
 *
 * Two modes:
 *
 *   1. **Project in scope** (`projectSlug` provided): the dropdown
 *      goes straight to that project's `/research` and `/plans` pages.
 *      This is the path the user takes from any `/p/<slug>/...` page.
 *
 *   2. **No project in scope** (e.g. the home page or `/tasks`): the
 *      dropdown still opens, but each top-level item expands into a
 *      submenu listing the team's projects. Picking one routes to
 *      `/p/<slug>/research` (or `/plans`) for that project. We never
 *      lock the button — Agents are usable from anywhere as long as
 *      the team has at least one project.
 *
 * Lives in its own client component so the Radix tree (Slot cloning
 * + sub-menus) stays inside a clean client boundary, avoiding the
 * RSC hydration mismatches we saw when this was inlined into the
 * server-rendered top bar.
 */
export function AgentsDropdown({
  projectSlug,
  active,
  projects,
}: {
  projectSlug: string | undefined;
  active: boolean;
  /**
   * The team's projects. Used to populate the project-picker
   * submenus when there's no active project. Pass `[]` (not
   * `undefined`) when the caller knows the answer is empty.
   */
  projects: ProjectListItem[];
}) {
  const hasScope = Boolean(projectSlug);
  const hasProjects = projects.length > 0;
  // Stay enabled unless the team genuinely has no project at all
  // (in which case research/plans don't have anywhere to live).
  const disabled = !hasScope && !hasProjects;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-current={active ? "page" : undefined}
          disabled={disabled}
          title={
            disabled
              ? "Create a project first to use agents"
              : undefined
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            active
              ? "bg-white/10 text-zinc-50"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
            disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
          )}
        >
          <Sparkles className="size-3.5" />
          Agents
          <ChevronDown className="size-3 text-zinc-500" />
        </button>
      </DropdownMenuTrigger>
      {disabled ? null : (
        <DropdownMenuContent align="end" className="w-56">
          {hasScope ? (
            <>
              <DropdownMenuItem asChild>
                <Link
                  href={`/p/${projectSlug}/research`}
                  className="flex w-full items-center gap-2"
                >
                  <Microscope className="size-3.5 text-emerald-400" />
                  <span className="flex-1">Research</span>
                  <span className="text-[10px] text-zinc-500">notes</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/p/${projectSlug}/plans`}
                  className="flex w-full items-center gap-2"
                >
                  <ClipboardList className="size-3.5 text-amber-400" />
                  <span className="flex-1">Plans</span>
                  <span className="text-[10px] text-zinc-500">tasks</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Project brain — semantic search over everything
                  indexed in this project. Sits below the
                  research/plans entries because it's a
                  retrieval surface, not an authoring one. */}
              <DropdownMenuItem asChild>
                <Link
                  href={`/p/${projectSlug}/brain`}
                  className="flex w-full items-center gap-2"
                >
                  <Brain className="size-3.5 text-sky-400" />
                  <span className="flex-1">Brain</span>
                  <span className="text-[10px] text-zinc-500">recall</span>
                </Link>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
                Pick a project
              </DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <Microscope className="size-3.5 text-emerald-400" />
                  <span className="flex-1">Research</span>
                  <span className="text-[10px] text-zinc-500">notes</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <ProjectMenuLinks
                    projects={projects}
                    section="research"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <ClipboardList className="size-3.5 text-amber-400" />
                  <span className="flex-1">Plans</span>
                  <span className="text-[10px] text-zinc-500">tasks</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <ProjectMenuLinks
                    projects={projects}
                    section="plans"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              {/* Brain submenu — same project-picker pattern. Kept
                  below the separator so it visually belongs to the
                  retrieval surface, not the authoring one. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <Brain className="size-3.5 text-sky-400" />
                  <span className="flex-1">Brain</span>
                  <span className="text-[10px] text-zinc-500">recall</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <ProjectMenuLinks
                    projects={projects}
                    section="brain"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-[10px] text-zinc-500">
                Agents work inside projects. Open one to chat with research,
                plans, or the project brain directly.
              </p>
            </>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

/**
 * Tiny helper that renders the team's projects as menu items
 * pointing at a given section. Projects are shown in the order
 * they came in (caller controls sort — `listProjectsForTeam` sorts
 * alphabetically, which is what we want here too).
 */
function ProjectMenuLinks({
  projects,
  section,
}: {
  projects: ProjectListItem[];
  section: "research" | "plans" | "brain";
}) {
  return (
    <>
      {projects.map((project) => (
        <DropdownMenuItem key={project.id} asChild>
          <Link
            href={`/p/${project.slug}/${section}`}
            className="flex w-full items-center gap-2"
          >
            {project.color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
            ) : (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-zinc-600"
              />
            )}
            <span className="flex-1 truncate">{project.name}</span>
          </Link>
        </DropdownMenuItem>
      ))}
    </>
  );
}
