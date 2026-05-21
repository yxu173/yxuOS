"use client";

import { Lock, Loader2, ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

interface LockOverlayProps {
  lockedByName: string;
  lockedByUsername: string | null;
  loading: boolean;
  onTakeOver: () => void;
}

export function LockOverlay({
  lockedByName,
  lockedByUsername,
  loading,
  onTakeOver,
}: LockOverlayProps) {
  if (loading) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-xl border border-white/5 bg-zinc-900 p-8 text-center shadow-2xl">
        <div className="rounded-full bg-amber-500/10 p-3">
          <Lock className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <p className="text-base font-medium text-zinc-100">
            {lockedByName}
            {lockedByUsername ? (
              <span className="font-normal text-zinc-400">
                {" "}
                @{lockedByUsername}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            is currently editing this board
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={onTakeOver}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Take over editing
        </Button>
      </div>
    </div>
  );
}
