"use client";

import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

import { CreateTeamDialog } from "./create-team-dialog";

export interface WorkspaceSwitcherTeam {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

export interface WorkspaceSwitcherProps {
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
}

/**
 * Team picker for the top bar.
 *
 * Displays the active team's initial + name, and a dropdown that lists every
 * team the user belongs to. Switching teams calls
 * `authClient.organization.setActive` then navigates to a safe surface — the
 * boards or designs index — because workspace items from the previous team
 * won't be accessible under the new active team.
 *
 * The dropdown also exposes a "Create team" item that opens
 * {@link CreateTeamDialog}.
 */
export function WorkspaceSwitcher({
  teams,
  activeTeamId,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);

  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];

  const switchTo = (id: string) => {
    if (id === activeTeamId) return;
    startTransition(async () => {
      await authClient.organization.setActive({ organizationId: id });
      // Navigate to a safe surface — the previous team's items aren't
      // accessible under the new team.
      const fallback = pathname?.startsWith("/designs")
        ? "/designs"
        : "/boards";
      router.push(fallback);
      router.refresh();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-sm font-medium text-zinc-200 hover:bg-white/5"
            disabled={pending}
            aria-label="Switch team"
          >
            <span className="grid size-4 shrink-0 place-items-center rounded bg-zinc-800 text-[9px] font-semibold text-zinc-200">
              {(active?.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-32 truncate">
              {active?.name ?? "No team"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-zinc-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
            Teams
          </DropdownMenuLabel>
          {teams.map((team) => (
            <DropdownMenuItem
              key={team.id}
              onSelect={() => switchTo(team.id)}
              className="justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-4 shrink-0 place-items-center rounded bg-zinc-800 text-[9px] font-semibold text-zinc-200">
                  {team.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{team.name}</span>
                {team.role !== "member" ? (
                  <span className="rounded border border-white/10 bg-white/5 px-1 py-px text-[9px] uppercase tracking-wide text-zinc-400">
                    {team.role}
                  </span>
                ) : null}
              </span>
              {team.id === activeTeamId ? (
                <Check className="size-3.5 text-zinc-300" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {active ? (
            <DropdownMenuItem asChild>
              <Link href={`/teams/${active.id}`} className="w-full">
                <Settings className="size-3.5" />
                Manage {active.name}
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreateOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Create team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
