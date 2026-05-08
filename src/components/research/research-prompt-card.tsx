"use client";

import { ArrowRight, Microscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { createResearchNote } from "@/app/(app)/research/actions";

export interface ResearchPromptCardProps {
  projectSlug: string;
}

/**
 * Top-of-the-index "ask the researcher" card.
 *
 * Submitting:
 *   1. Creates a fresh research note via `createResearchNote` (server
 *      action — uses the active session for permissioning).
 *   2. Navigates to `/p/<slug>/research/<noteId>?ask=<encoded prompt>`.
 *      The shell's research-chat reads `?ask=` and auto-fires the
 *      first turn, so the user lands mid-conversation rather than on
 *      a blank composer.
 *
 * Empty submissions just create a blank note and drop the user into
 * it — handy when you want to start from a different angle than
 * "ask a question".
 */
export function ResearchPromptCard({ projectSlug }: ResearchPromptCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = prompt.trim();
    startTransition(async () => {
      try {
        const { id } = await createResearchNote({ projectSlug });
        const target = trimmed
          ? `/p/${projectSlug}/research/${id}?ask=${encodeURIComponent(trimmed)}`
          : `/p/${projectSlug}/research/${id}`;
        router.push(target);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't create the note.",
        );
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-4"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
        <Microscope className="size-3.5 text-emerald-400" />
        Ask the researcher
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !pending
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        rows={2}
        placeholder="e.g. How are we currently handling auth across the app?"
        disabled={pending}
        className="resize-none rounded-md border border-white/10 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none"
      />
      {error ? (
        <p className="text-xs text-red-300">{error}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500">
        <span>
          Pulls from your project + the web. Cites every claim.
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? "Starting…" : "Start research"}
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
