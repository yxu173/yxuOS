"use client";

import {
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useTransition } from "react";

import {
  deletePlanRow,
  materialiseApprovedRows,
  setPlanRowApproval,
  setPlanRowsApproval,
  type TaskPlanRowSummary,
} from "@/app/(app)/plans/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
} from "@/lib/tasks/task-types";

export interface PlanRowsProps {
  planId: string;
  projectSlug: string;
  rows: TaskPlanRowSummary[];
}

/**
 * The plan's rows table — the artifact the planner is authoring and the
 * user is approving.
 *
 * Three sections separated visually:
 *   1. **Pending** rows (no approval, no created task) — checkbox + delete.
 *   2. **Approved** rows (approval set, no created task) — checked
 *      checkbox + delete; counted in the bulk-create CTA.
 *   3. **Executed** rows (have a `createdTaskId`) — read-only with a
 *      link to the created task.
 *
 * Optimistic state is used for the approval checkbox so toggling feels
 * immediate; the server action then revalidates the page.
 */
export function PlanRows({ planId, projectSlug, rows }: PlanRowsProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // Optimistic approval state: a Set of row ids that should display as
  // approved, derived from server `rows` plus any pending toggles.
  const initialApproved = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => r.approvedAt && !r.createdTaskId)
          .map((r) => r.id),
      ),
    [rows],
  );
  const [optimisticApproved, applyToggle] = useOptimistic(
    initialApproved,
    (current: Set<string>, action: { id: string; approved: boolean }) => {
      const next = new Set(current);
      if (action.approved) next.add(action.id);
      else next.delete(action.id);
      return next;
    },
  );

  const toggleApproval = (rowId: string, approved: boolean) => {
    startTransition(async () => {
      applyToggle({ id: rowId, approved });
      try {
        await setPlanRowApproval(rowId, approved);
        router.refresh();
      } catch (err) {
        console.error("[plan] approval toggle failed", err);
      }
    });
  };

  const removeRow = (rowId: string) => {
    if (!confirm("Remove this row from the plan?")) return;
    startTransition(async () => {
      try {
        await deletePlanRow(rowId);
        router.refresh();
        toast.success("Row removed.");
      } catch (err) {
        console.error("[plan] row delete failed", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't remove row.",
        );
      }
    });
  };

  const selectAllPending = () => {
    const pendingIds = rows
      .filter((r) => !r.createdTaskId && !r.approvedAt)
      .map((r) => r.id);
    if (pendingIds.length === 0) return;
    startTransition(async () => {
      pendingIds.forEach((id) => applyToggle({ id, approved: true }));
      try {
        await setPlanRowsApproval(pendingIds, true);
        router.refresh();
      } catch (err) {
        console.error("[plan] bulk approve failed", err);
      }
    });
  };

  const clearAllApprovals = () => {
    const ids = Array.from(optimisticApproved);
    if (ids.length === 0) return;
    startTransition(async () => {
      ids.forEach((id) => applyToggle({ id, approved: false }));
      try {
        await setPlanRowsApproval(ids, false);
        router.refresh();
      } catch (err) {
        console.error("[plan] bulk clear failed", err);
      }
    });
  };

  const create = () => {
    if (optimisticApproved.size === 0) return;
    startTransition(async () => {
      try {
        const result = await materialiseApprovedRows(planId);
        router.refresh();
        // Confirmation toast — this action creates real data on
        // the task board, so a small acknowledgement helps the
        // user feel grounded after the bulk write.
        const noun = result.createdCount === 1 ? "task" : "tasks";
        toast.success(`Created ${result.createdCount} ${noun}.`);
      } catch (err) {
        console.error("[plan] materialise failed", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't create tasks.",
        );
      }
    });
  };

  const approvedCount = optimisticApproved.size;
  const pendingCount = rows.filter(
    (r) => !r.createdTaskId && !optimisticApproved.has(r.id),
  ).length;
  const executedCount = rows.filter((r) => r.createdTaskId).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-white/5 px-6 py-2 text-xs text-zinc-500">
        <span>
          {rows.length} row{rows.length === 1 ? "" : "s"}
          <span className="mx-1.5 text-zinc-700">·</span>
          {pendingCount} pending · {approvedCount} approved · {executedCount}{" "}
          executed
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {approvedCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllApprovals}
              disabled={pending}
              className="h-7 text-[11px]"
            >
              Clear all
            </Button>
          ) : null}
          {pendingCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={selectAllPending}
              disabled={pending}
              className="h-7 text-[11px]"
            >
              Approve all pending
            </Button>
          ) : null}
        </div>
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {rows.length === 0 ? (
          <EmptyRows />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <PlanRowItem
                key={row.id}
                row={row}
                projectSlug={projectSlug}
                approved={optimisticApproved.has(row.id)}
                onToggle={(checked) => toggleApproval(row.id, checked)}
                onRemove={() => removeRow(row.id)}
                disabled={pending}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Sticky bulk-create bar */}
      <div className="border-t border-white/5 bg-zinc-950/60 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Sparkles className="size-3.5 text-amber-400" />
            <span>
              {approvedCount === 0
                ? "Tick rows to approve them, then create tasks."
                : `${approvedCount} approved row${approvedCount === 1 ? "" : "s"} ready to create.`}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={create}
            disabled={approvedCount === 0 || pending}
            className="ml-auto gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Create {approvedCount > 0 ? `${approvedCount} task${approvedCount === 1 ? "" : "s"}` : "tasks"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanRowItem({
  row,
  projectSlug,
  approved,
  onToggle,
  onRemove,
  disabled,
}: {
  row: TaskPlanRowSummary;
  projectSlug: string;
  approved: boolean;
  onToggle: (checked: boolean) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const executed = row.createdTaskId !== null;
  return (
    <li
      className={cn(
        "group rounded-md border p-3 transition-colors",
        executed
          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
          : approved
            ? "border-amber-500/30 bg-amber-500/[0.04]"
            : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox column */}
        <div className="pt-0.5">
          {executed ? (
            <span
              title="Already created as a task"
              className="flex size-4 items-center justify-center rounded-sm bg-emerald-500/30 text-emerald-200"
            >
              <Check className="size-3" />
            </span>
          ) : (
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => onToggle(event.target.checked)}
              disabled={disabled}
              aria-label={
                approved ? "Unapprove this row" : "Approve this row"
              }
              className="size-4 cursor-pointer rounded-sm border border-white/20 bg-transparent accent-amber-500"
            />
          )}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">
              {row.title}
            </span>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px]",
                TASK_STATUS_TONES[row.status],
              )}
            >
              {TASK_STATUS_LABELS[row.status]}
            </span>
            <span
              className={cn(
                "shrink-0 text-[10px] font-medium",
                TASK_PRIORITY_TONES[row.priority],
              )}
            >
              {TASK_PRIORITY_LABELS[row.priority]}
            </span>
          </div>
          {row.description ? (
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
              {row.description}
            </p>
          ) : null}
          {(row.assigneeName || row.dueDate) && (
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
              {row.assigneeName ? (
                <span>→ {row.assigneeName}</span>
              ) : null}
              {row.dueDate ? (
                <span className="tabular-nums">
                  due{" "}
                  {row.dueDate.toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null}
            </div>
          )}
          {executed && row.createdTaskId ? (
            <Link
              href={`/p/${projectSlug}/tasks/${row.createdTaskId}`}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:underline"
            >
              View task
              <ChevronRight className="size-3" />
            </Link>
          ) : null}
        </div>

        {/* Actions */}
        {!executed ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove this row"
            title="Remove row"
            className="rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-white/5 hover:text-red-300 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function EmptyRows() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.015] px-5 py-6">
      <p className="text-sm text-zinc-400">No rows yet.</p>
      <p className="text-xs text-zinc-500">
        Describe the goal in the chat on the right. The planner will
        propose rows here, and you can tick the ones you want and bulk-
        create them as real tasks.
      </p>
    </div>
  );
}
