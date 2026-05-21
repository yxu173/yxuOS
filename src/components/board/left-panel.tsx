"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { createBoard } from "@/app/(app)/boards/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface BoardSummary {
  id: string;
  name: string;
  updatedAt: Date;
}

export interface LeftPanelProps {
  boards: BoardSummary[];
  activeBoardId: string;
  /** Base href for sibling boards in the list (e.g. `/p/<slug>/boards`). */
  boardsHrefBase: string;
  /** Slug for the currently active project — used so the inline "+" creates a board in the same project. */
  projectSlug: string;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

function formatDate(val: string | Date): string {
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return "";
  return dateFormatter.format(d);
}

export function LeftPanel({
  boards,
  activeBoardId,
  boardsHrefBase,
  projectSlug,
}: LeftPanelProps) {
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-white/5 bg-zinc-950/40 backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Chats
        </h2>
        <form
          action={() => {
            startTransition(async () => {
              await createBoard(projectSlug);
            });
          }}
        >
          <Button
            type="submit"
            size="icon-xs"
            variant="ghost"
            disabled={pending}
            title="New board"
            aria-label="New board"
          >
            <Plus className="size-3.5" />
          </Button>
        </form>
      </div>

      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-0.5 p-2">
          {boards.length === 0 ? (
            <li className="px-2 py-3 text-xs text-zinc-500">
              No chats yet. Create one above.
            </li>
          ) : (
            boards.map((board) => {
              const isActive = board.id === activeBoardId;
              return (
                <li key={board.id}>
                  <Link
                    href={`${boardsHrefBase}/${board.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-white/10 text-zinc-50"
                        : "text-zinc-300 hover:bg-white/5",
                    )}
                  >
                    <span className="truncate">{board.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {formatDate(board.updatedAt)}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
