"use client";

import { useState, useTransition } from "react";

import { addMemberByUsername } from "@/app/(app)/teams/[teamId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamRole } from "@/lib/permissions";

export interface TeamAddMemberFormProps {
  teamId: string;
  actorRole: TeamRole;
}

const OWNER_ROLE_OPTIONS: TeamRole[] = ["owner", "admin", "member"];
const ADMIN_ROLE_OPTIONS: TeamRole[] = ["member"];

export function TeamAddMemberForm({
  teamId,
  actorRole,
}: TeamAddMemberFormProps) {
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const roleOptions =
    actorRole === "owner" ? OWNER_ROLE_OPTIONS : ADMIN_ROLE_OPTIONS;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    const trimmed = username.trim().replace(/^@+/, "");
    if (!trimmed) {
      setError("Username is required");
      return;
    }

    startTransition(async () => {
      try {
        const { userName } = await addMemberByUsername(teamId, trimmed, role);
        setUsername("");
        setRole("member");
        setInfo(`Added ${userName} as ${role}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add member");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="relative flex flex-1 min-w-48 items-center">
          <span className="pointer-events-none absolute left-3 text-sm text-zinc-500">
            @
          </span>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="username"
            className="pl-7"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            disabled={pending}
          />
        </div>
        <Select
          value={role}
          onValueChange={(next) => setRole(next as TeamRole)}
          disabled={pending}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
      {info ? <p className="text-xs text-emerald-500">{info}</p> : null}
    </form>
  );
}
