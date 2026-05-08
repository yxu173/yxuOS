import { FileText } from "lucide-react";
import Link from "next/link";

import type { ResearchNoteSummary } from "@/app/(app)/research/actions";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

const STATUS_STYLES: Record<string, string> = {
  draft: "border-white/10 bg-white/5 text-zinc-300",
  reviewed:
    "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  archived: "border-white/5 bg-white/[0.02] text-zinc-500",
};

export interface ResearchNoteCardProps {
  note: ResearchNoteSummary;
  projectSlug: string;
}

/**
 * One row in the research index. A link to the note plus its preview,
 * status badge, and a "<author> · <date>" stamp on the right.
 */
export function ResearchNoteCard({
  note,
  projectSlug,
}: ResearchNoteCardProps) {
  return (
    <Link
      href={`/p/${projectSlug}/research/${note.id}`}
      className="group flex items-start gap-3 rounded-md border border-white/5 bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.03]"
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-zinc-500 group-hover:text-zinc-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">
            {note.title || "Untitled research"}
          </span>
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] capitalize",
              STATUS_STYLES[note.status] ?? STATUS_STYLES.draft,
            )}
          >
            {note.status}
          </span>
        </div>
        {note.preview ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
            {note.preview}
          </p>
        ) : (
          <p className="mt-0.5 text-xs italic text-zinc-600">
            (empty — start the research conversation)
          </p>
        )}
      </div>
      <div className="shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
        <div>{dateFmt.format(note.updatedAt)}</div>
        {note.authorName ? (
          <div className="truncate text-[10px] text-zinc-600">
            {note.authorName}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
