"use client";

import { MoreHorizontal, ShieldCheck, UserMinus, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  leaveTeam,
  removeTeamMember,
  updateMemberRole,
} from "@/app/(app)/teams/[teamId]/actions";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TeamRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface TeamMemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  username: string | null;
  role: TeamRole;
  joinedAt: Date;
  isYou: boolean;
}

export interface TeamMemberListProps {
  teamId: string;
  actorRole: TeamRole;
  members: TeamMemberRow[];
}

const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function TeamMemberList({
  teamId,
  actorRole,
  members,
}: TeamMemberListProps) {
  return (
    <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-white/[0.02]">
      {members.map((m) => (
        <li
          key={m.memberId}
          className="flex items-center gap-3 px-4 py-3"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
            {initials(m.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-zinc-100">
              {m.name}
              {m.isYou ? (
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  (you)
                </span>
              ) : null}
            </span>
            <span className="truncate text-xs text-zinc-500">
              {m.username ? `@${m.username}` : m.email}
            </span>
          </div>
          <RoleBadge role={m.role} />
          <MemberActions
            teamId={teamId}
            actorRole={actorRole}
            row={m}
          />
        </li>
      ))}
    </ul>
  );
}

/* ─── role badge ────────────────────────────────── */

function RoleBadge({ role }: { role: TeamRole }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        role === "owner"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : role === "admin"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
            : "border-white/10 bg-white/5 text-zinc-400",
      )}
    >
      {role}
    </span>
  );
}

/* ─── per-row actions ─────────────────────────── */

interface MemberActionsProps {
  teamId: string;
  actorRole: TeamRole;
  row: TeamMemberRow;
}

function MemberActions({ teamId, actorRole, row }: MemberActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState<
    null | "remove" | "leave"
  >(null);

  // Capability matrix:
  // - Owners can change any role and remove anyone (except the last owner).
  // - Admins can remove members only.
  // - Members get no actions on others, but everyone can leave their own row.
  const canChangeRole = actorRole === "owner" && !row.isYou;
  const canRemove =
    !row.isYou &&
    (actorRole === "owner" ||
      (actorRole === "admin" && ROLE_RANK[row.role] === 0));
  const canLeave = row.isYou;

  if (!canChangeRole && !canRemove && !canLeave) {
    return null;
  }

  const setRole = (next: TeamRole) => {
    if (next === row.role) return;
    startTransition(async () => {
      try {
        await updateMemberRole(teamId, row.memberId, next);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to change role");
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      try {
        await removeTeamMember(teamId, row.memberId);
        setConfirmOpen(null);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to remove member");
      }
    });
  };

  const leave = () => {
    startTransition(async () => {
      try {
        await leaveTeam(teamId);
        setConfirmOpen(null);
        router.push("/boards");
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to leave team");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label="Member actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canChangeRole ? (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
                Change role
              </DropdownMenuLabel>
              {(["owner", "admin", "member"] as const).map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={() => setRole(r)}
                  disabled={r === row.role}
                >
                  {r === "owner" ? (
                    <ShieldCheck className="size-3.5" />
                  ) : (
                    <UserCog className="size-3.5" />
                  )}
                  {r}
                  {r === row.role ? (
                    <span className="ml-auto text-[10px] uppercase text-zinc-500">
                      current
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
              {canRemove ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {canRemove ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen("remove");
              }}
              className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
            >
              <UserMinus className="size-3.5" />
              Remove from team
            </DropdownMenuItem>
          ) : null}
          {canLeave ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen("leave");
              }}
              className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
            >
              <UserMinus className="size-3.5" />
              Leave team
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmOpen !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "remove"
                ? `Remove ${row.name}?`
                : "Leave this team?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmOpen === "remove"
                ? "They'll lose access to every board, design, component, and asset on this team."
                : "You'll lose access to every board, design, component, and asset on this team. Another owner has to add you back."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirmOpen === "remove") remove();
                else leave();
              }}
              disabled={pending}
              className="bg-red-600 hover:bg-red-700"
            >
              {confirmOpen === "remove"
                ? pending
                  ? "Removing…"
                  : "Remove"
                : pending
                  ? "Leaving…"
                  : "Leave team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
