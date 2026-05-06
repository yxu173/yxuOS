"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { createDesign } from "@/app/(app)/designs/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface DesignSummary {
  id: string;
  name: string;
  updatedAt: Date;
}

export interface DesignLeftPanelProps {
  designs: DesignSummary[];
  activeDesignId: string;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

export function DesignLeftPanel({
  designs,
  activeDesignId,
}: DesignLeftPanelProps) {
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-white/5 bg-zinc-950/40 backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Designs
        </h2>
        <form
          action={() => {
            startTransition(async () => {
              await createDesign();
            });
          }}
        >
          <Button
            type="submit"
            size="icon-xs"
            variant="ghost"
            disabled={pending}
            title="New design"
            aria-label="New design"
          >
            <Plus className="size-3.5" />
          </Button>
        </form>
      </div>

      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-0.5 p-2">
          {designs.length === 0 ? (
            <li className="px-2 py-3 text-xs text-zinc-500">
              No designs yet. Create one above.
            </li>
          ) : (
            designs.map((design) => {
              const isActive = design.id === activeDesignId;
              return (
                <li key={design.id}>
                  <Link
                    href={`/designs/${design.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-white/10 text-zinc-50"
                        : "text-zinc-300 hover:bg-white/5",
                    )}
                  >
                    <span className="truncate">{design.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {dateFormatter.format(design.updatedAt)}
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
