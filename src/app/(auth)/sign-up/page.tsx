"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");

  // Debounced username availability check. We're knowingly syncing the
  // UI state to a derived input here — that's exactly what the
  // set-state-in-effect rule warns against, but the alternative
  // (computing during render) doesn't fit because we also fire an
  // async availability check.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      setUsernameStatus("idle");
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      const result = await authClient.isUsernameAvailable({
        username: trimmed,
      });
      if (result.data?.available) {
        setUsernameStatus("available");
      } else {
        setUsernameStatus("taken");
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [username]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!USERNAME_RE.test(username.trim())) {
      setError(
        "Username must be 3-30 characters, letters / numbers / underscore / dot only.",
      );
      return;
    }
    setPending(true);

    const result = await authClient.signUp.email({
      email,
      password,
      name,
      username: username.trim(),
    });

    if (result.error) {
      setError(result.error.message ?? "Sign up failed");
      setPending(false);
      return;
    }

    router.push("/boards");
    router.refresh();
  };

  const usernameHint = (() => {
    switch (usernameStatus) {
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
      default:
        return null;
    }
  })();

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your yxuOS account</CardTitle>
        <CardDescription>Start a new board in seconds.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="username">
              Username
              <span className="ml-2 text-[10px] font-normal text-zinc-500">
                teammates use this to add you
              </span>
            </Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={30}
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.replace(/\s+/g, ""))
              }
            />
            {usernameHint ? (
              <p className="text-xs">{usernameHint}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={pending || usernameStatus === "taken" || usernameStatus === "invalid"}
            className="w-full"
          >
            {pending ? "Creating account\u2026" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
