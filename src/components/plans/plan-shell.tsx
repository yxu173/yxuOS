"use client";

import type { UIMessage } from "ai";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updatePlan, type TaskPlanDetail } from "@/app/(app)/plans/actions";

import { PlanChat } from "./plan-chat";
import { PlanRows } from "./plan-rows";

export interface PlanShellProps {
  plan: TaskPlanDetail;
  initialMessages: UIMessage[];
  initialPrompt?: string;
}

/**
 * Two-pane plan surface.
 *
 *   ┌──────── plan rows (left) ─────────┬─ chat (right) ─┐
 *   │ Title strip · row count           │ Planner        │
 *   │ Approval checkboxes per row       │ message stream │
 *   │ Sticky bulk-create CTA            │ Composer       │
 *   └───────────────────────────────────┴────────────────┘
 *
 * Top strip carries:
 *   - Inline-editable plan title.
 *   - "From: <note>" badge linking back to the source research note,
 *     when this plan was created via handoff.
 *   - Plan status pill (draft / executed / archived).
 */
export function PlanShell({
  plan,
  initialMessages,
  initialPrompt,
}: PlanShellProps) {
  return (
    <div className="grid h-[calc(100vh-3rem)] min-h-0 w-full grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-col border-r border-white/5">
        <PlanHeader plan={plan} />
        <PlanRows
          planId={plan.id}
          projectSlug={plan.projectSlug}
          rows={plan.rows}
        />
      </section>
      <aside className="min-h-0 min-w-0 bg-zinc-950/40">
        <PlanChat
          planId={plan.id}
          initialMessages={initialMessages}
          initialPrompt={initialPrompt}
        />
      </aside>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "border-white/10 bg-white/5 text-zinc-300",
  executed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  archived: "border-white/5 bg-white/[0.02] text-zinc-500",
};

function PlanHeader({ plan }: { plan: TaskPlanDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(plan.title);

  const saveTitle = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === plan.title) return;
    startTransition(async () => {
      try {
        await updatePlan({ id: plan.id, title: trimmed });
        router.refresh();
      } catch (err) {
        console.error("[plan] title save failed", err);
      }
    });
  };

  return (
    <header className="flex flex-col gap-2 border-b border-white/5 px-6 py-3">
      <div className="flex items-center gap-3">
        <Link
          href={`/p/${plan.projectSlug}/plans`}
          className="text-zinc-500 hover:text-zinc-200"
          title="Back to plans"
          aria-label="Back to plans"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={(event) => saveTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          maxLength={200}
          placeholder="Untitled plan"
          disabled={pending}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight text-zinc-50 placeholder:text-zinc-700 focus:outline-none"
        />
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] capitalize ${STATUS_STYLES[plan.status] ?? STATUS_STYLES.draft}`}
        >
          {plan.status}
        </span>
        <Pencil className="size-3.5 text-zinc-700" aria-hidden />
      </div>
      {plan.sourceNoteId ? (
        <Link
          href={`/p/${plan.projectSlug}/research/${plan.sourceNoteId}`}
          className="inline-flex w-fit items-center gap-1.5 rounded border border-emerald-500/20 bg-emerald-500/[0.04] px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/[0.08]"
        >
          <FileText className="size-3" />
          From research: {plan.sourceNoteTitle ?? "(deleted)"}
        </Link>
      ) : null}
    </header>
  );
}
