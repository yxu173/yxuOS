"use client";

import { ClipboardList, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createPlan } from "@/app/(app)/plans/actions";
import { Button } from "@/components/ui/button";

export interface HandoffToPlannerButtonProps {
  noteId: string;
  noteTitle: string;
  projectSlug: string;
}

/**
 * "Hand off to planner" — the explicit handoff between agents.
 *
 * Clicking creates a fresh plan with `sourceNoteId` already set to
 * this note. The route handler stamps that on the plan so when the
 * planner agent calls `read_research_note` with no args on its first
 * turn, it auto-resolves to the right note. The artifact (the plan
 * with a populated `source_note_id`) IS the handoff protocol — there
 * is no shared memory between the two agents, just this fk.
 *
 * After creating, we route to `/p/<slug>/plans/<planId>?ask=...` with
 * a seeded prompt so the planner immediately knows it's been handed
 * a note and starts by reading it.
 */
export function HandoffToPlannerButton({
  noteId,
  noteTitle,
  projectSlug,
}: HandoffToPlannerButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handoff = () => {
    startTransition(async () => {
      try {
        const { id } = await createPlan({
          projectSlug,
          title: noteTitle && noteTitle !== "Untitled research"
            ? `Plan for: ${noteTitle}`
            : undefined,
          sourceNoteId: noteId,
        });
        // Seed the planner with an explicit cue. The agent's prompt
        // tells it to call `read_research_note` first when there's a
        // source note, so this becomes a concrete kick-off message.
        const ask = `I just handed you research note "${noteTitle}". Read it (it's set as this plan's source note) and propose a first cut of rows.`;
        router.push(
          `/p/${projectSlug}/plans/${id}?ask=${encodeURIComponent(ask)}`,
        );
      } catch (err) {
        console.error("[handoff] failed", err);
        alert(
          err instanceof Error
            ? err.message
            : "Couldn't hand off to planner.",
        );
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handoff}
      disabled={pending}
      className="gap-1.5 border border-amber-500/20 bg-amber-500/[0.03] text-amber-300 hover:bg-amber-500/[0.08]"
      title="Create a plan from this research note"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <ClipboardList className="size-3.5" />
      )}
      Hand off to planner
    </Button>
  );
}
