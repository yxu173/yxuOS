"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

export interface ProfileFormProps {
  initialName: string;
  initialUsername: string;
  email: string;
}

type UsernameStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "current";

export function ProfileForm({
  initialName,
  initialUsername,
  email,
}: ProfileFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername);
  const [status, setStatus] = useState<UsernameStatus>("current");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Live availability check for the username field. Skips lookup when the
  // value matches the current username so we don't flicker "taken" on the
  // user's own name.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setError(null);
    setInfo(null);
    const trimmed = username.trim();
    if (!trimmed) {
      setStatus("invalid");
      return;
    }
    if (
      trimmed.toLowerCase() === initialUsername.toLowerCase() &&
      trimmed === initialUsername
    ) {
      setStatus("current");
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    const handle = setTimeout(async () => {
      const result = await authClient.isUsernameAvailable({
        username: trimmed,
      });
      setStatus(result.data?.available ? "available" : "taken");
    }, 350);
    return () => clearTimeout(handle);
  }, [username, initialUsername]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const usernameHint = (() => {
    switch (status) {
      case "checking":
        return <span className="text-zinc-500">Checking…</span>;
      case "available":
        return <span className="text-emerald-400">Available</span>;
      case "taken":
        return <span className="text-destructive">Already taken</span>;
      case "invalid":
        return (
          <span className="text-destructive">
            3–30 chars: letters / numbers / _ / .
          </span>
        );
      case "current":
        return <span className="text-zinc-500">Your current username</span>;
      default:
        return null;
    }
  })();

  const trimmedName = name.trim();
  const trimmedUsername = username.trim();
  const dirty =
    trimmedName !== initialName.trim() || trimmedUsername !== initialUsername;
  const usernameValid =
    status === "current" || status === "available";
  const canSubmit = !pending && dirty && trimmedName.length > 0 && usernameValid;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!canSubmit) return;

    startTransition(async () => {
      const payload: { name?: string; username?: string } = {};
      if (trimmedName !== initialName.trim()) payload.name = trimmedName;
      if (trimmedUsername !== initialUsername) {
        payload.username = trimmedUsername;
      }
      const result = await authClient.updateUser(payload);
      if (result.error) {
        setError(result.error.message ?? "Failed to update profile");
        return;
      }
      setInfo("Profile updated");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="account-email">Email</Label>
        <Input
          id="account-email"
          value={email}
          readOnly
          disabled
          className="cursor-not-allowed text-muted-foreground"
        />
        <p className="text-xs text-muted-foreground">
          Email changes aren&apos;t supported yet — get in touch if you need
          to switch.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="account-name">Name</Label>
        <Input
          id="account-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="account-username">Username</Label>
        <Input
          id="account-username"
          value={username}
          onChange={(event) =>
            setUsername(event.target.value.replace(/\s+/g, ""))
          }
          minLength={3}
          maxLength={30}
          autoComplete="username"
          required
        />
        {usernameHint ? <p className="text-xs">{usernameHint}</p> : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {info ? <p className="text-sm text-emerald-400">{info}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
