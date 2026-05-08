"use client";

import { ArrowRight, ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createPlan } from "@/app/(app)/plans/actions";
import { Button } from "@/components/ui/button";

export interface PlanPromptCardProps {
  projectSlug: string;
}

/**
 * Top-of-the-index "Ask the planner" card.
 *
 * Submitting:
 *   1. Creates a fresh plan (no source note — that path lives on the
 *      research note's "Hand off to planner" button, which calls the
 *      same action with `sourceNoteId` set).
 *   2. Routes to `/p/<slug>/plans/<planId>?ask=<prompt>`.
 *      The shell forwards `ask` to the chat which auto-fires the first
 *      turn so the user lands mid-conversation.
 */
export function PlanPromptCard({ projectSlug }: PlanPromptCardProps) {
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
        const { id } = await createPlan({ projectSlug });
        const target = trimmed
          ? `/p/${projectSlug}/plans/${id}?ask=${encodeURIComponent(trimmed)}`
          : `/p/${projectSlug}/plans/${id}`;
        router.push(target);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't create the plan.",
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
        <ClipboardList className="size-3.5 text-amber-400" />
        Ask the planner
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
        placeholder="e.g. Break the auth migration into shippable rows."
        disabled={pending}
        className="resize-none rounded-md border border-white/10 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none"
      />
      {error ? (
        <p className="text-xs text-red-300">{error}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500">
        <span>
          Proposes rows you can approve and bulk-create as real tasks.
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? "Starting…" : "Start planning"}
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
