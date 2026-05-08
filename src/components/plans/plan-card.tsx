import { ClipboardList, FileText } from "lucide-react";
import Link from "next/link";

import type { TaskPlanSummary } from "@/app/(app)/plans/actions";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

const STATUS_STYLES: Record<string, string> = {
  draft: "border-white/10 bg-white/5 text-zinc-300",
  executed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  archived: "border-white/5 bg-white/[0.02] text-zinc-500",
};

export interface PlanCardProps {
  plan: TaskPlanSummary;
  projectSlug: string;
}

/**
 * One row in the plans index. Mirrors the research-note card with
 * planning-specific stats (rows · approved · executed) instead of a
 * Markdown preview.
 */
export function PlanCard({ plan, projectSlug }: PlanCardProps) {
  return (
    <Link
      href={`/p/${projectSlug}/plans/${plan.id}`}
      className="group flex items-start gap-3 rounded-md border border-white/5 bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.03]"
    >
      <ClipboardList className="mt-0.5 size-4 shrink-0 text-zinc-500 group-hover:text-zinc-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">
            {plan.title || "Untitled plan"}
          </span>
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] capitalize",
              STATUS_STYLES[plan.status] ?? STATUS_STYLES.draft,
            )}
          >
            {plan.status}
          </span>
          {plan.sourceNoteTitle ? (
            <span
              className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/[0.04] px-1.5 py-0.5 text-[10px] text-emerald-300"
              title={`From research: ${plan.sourceNoteTitle}`}
            >
              <FileText className="size-2.5" />
              From research
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
          {plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}
          <span className="mx-1.5 text-zinc-700">·</span>
          {plan.approvedRowCount} approved
          <span className="mx-1.5 text-zinc-700">·</span>
          {plan.executedRowCount} executed
        </p>
      </div>
      <div className="shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
        <div>{dateFmt.format(plan.updatedAt)}</div>
        {plan.authorName ? (
          <div className="truncate text-[10px] text-zinc-600">
            {plan.authorName}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
