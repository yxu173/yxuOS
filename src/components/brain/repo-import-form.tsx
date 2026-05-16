"use client";

import { Loader2, Lock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importRepo } from "@/app/(app)/repos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * "Import a GitHub repo" form.
 *
 * Two fields: URL (required) + optional token. The token is masked
 * with type=password but stored as plaintext server-side; documented
 * up-front in the help text so users can decide whether they trust
 * the host enough to paste a PAT.
 *
 * The submit path runs the GitHub metadata fetch *synchronously*
 * inside the server action, so URL typos / bad tokens / private
 * repos with no token all surface as inline errors before the form
 * resets. The actual indexing kicks off after that check in `after()`.
 */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.55 0-.27-.01-1.16-.02-2.1-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.71.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.83 0c2.22-1.49 3.2-1.18 3.2-1.18.64 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .3.21.66.8.55C20.21 21.4 23.5 17.09 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function RepoImportForm({ projectSlug }: { projectSlug: string }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a GitHub repo URL.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importRepo({
          projectSlug,
          url: trimmed,
          accessToken: token.trim() || null,
        });
        if (result.existed) {
          toast.info("Already imported — this repo + branch is already in the project brain.");
        } else {
          toast.success("Import started — indexing runs in the background.");
          setUrl("");
          setToken("");
          setShowToken(false);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/50 p-3"
    >
      <div className="flex items-center gap-2">
        <GithubIcon className="h-4 w-4 text-zinc-400" aria-hidden />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo  or  owner/repo"
          disabled={isPending}
          className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <Button type="submit" size="sm" disabled={isPending || !url.trim()}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Import
            </>
          )}
        </Button>
      </div>

      {showToken ? (
        <div className="flex items-center gap-2 border-t border-zinc-800/60 pt-2">
          <Lock className="h-4 w-4 text-zinc-500" aria-hidden />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_… (GitHub personal access token)"
            disabled={isPending}
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => {
              setShowToken(false);
              setToken("");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowToken(true)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-300"
        >
          Private repo? Add a token →
        </button>
      )}

      {error ? (
        <p className="text-xs text-rose-400">{error}</p>
      ) : (
        <p className="text-xs text-zinc-500">
          Public repos: no token required. Private: needs a PAT with the{" "}
          <code className="rounded bg-zinc-900 px-1">repo</code> scope.
        </p>
      )}
    </form>
  );
}
