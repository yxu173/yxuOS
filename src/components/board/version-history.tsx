"use client";

import { History, RotateCcw, Loader2 } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  listBoardVersions,
  restoreBoardVersion,
} from "@/app/(app)/boards/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface VersionEntry {
  id: string;
  createdAt: Date;
  editedBy: {
    name: string;
    username: string | null;
  };
}

export interface VersionHistoryProps {
  boardId: string;
}

export function VersionHistory({ boardId }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await listBoardVersions(boardId);
      setVersions(data);
    } catch {
      setVersions([]);
    }
  }, [boardId]);

  // Initial load — fire once on mount via a ref guard to avoid
  // double-fire in StrictMode. The guard prevents cascading renders.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  const handleRestore = useCallback(
    (versionId: string) => {
      setRestoringId(versionId);
      startTransition(async () => {
        try {
          await restoreBoardVersion(boardId, versionId);
          await load();
        } catch (err) {
          console.error("Failed to restore version:", err);
        } finally {
          setRestoringId(null);
        }
      });
    },
    [boardId, load],
  );

  // Not yet loaded — show spinner.
  if (versions === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading history…
      </div>
    );
  }

  return (
    <VersionHistoryList
      versions={versions}
      restoringId={restoringId}
      onRestore={handleRestore}
    />
  );
}

function VersionHistoryList({
  versions,
  restoringId,
  onRestore,
}: {
  versions: VersionEntry[];
  restoringId: string | null;
  onRestore: (versionId: string) => void;
}) {
  if (versions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-zinc-500">
        <div>
          <History className="mx-auto mb-2 h-6 w-6 opacity-40" />
          <p>No edit history yet.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Versions are saved automatically as you edit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-px p-2">
        {versions.map((v, i) => {
          const time = formatTime(v.createdAt);
          const date = formatDate(v.createdAt);
          const showDate =
            i === 0 ||
            formatDate(versions[i - 1].createdAt) !== date;

          return (
            <div key={v.id}>
              {showDate ? (
                <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  {date}
                </div>
              ) : null}
              <div
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/3",
                  restoringId === v.id && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-200">
                    {v.editedBy.name}
                    {v.editedBy.username ? (
                      <span className="ml-1 font-normal text-zinc-500">
                        @{v.editedBy.username}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-zinc-500">{time}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onRestore(v.id)}
                  disabled={restoringId !== null}
                  title="Restore this version"
                >
                  {restoringId === v.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  <span className="text-[11px]">Restore</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function formatTime(date: Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}
