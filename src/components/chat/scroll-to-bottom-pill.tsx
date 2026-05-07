"use client";

import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ScrollToBottomPillProps {
  visible: boolean;
  onClick: () => void;
  /** Optional unread-count badge for when the agent is streaming below the fold. */
  hint?: string;
}

/**
 * Floating "jump to latest" pill that appears at the bottom of the chat
 * scroll area when the user has scrolled away while messages are arriving.
 *
 * Positioned absolutely just above the composer.
 */
export function ScrollToBottomPill({
  visible,
  onClick,
  hint,
}: ScrollToBottomPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "pointer-events-auto absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/90 px-3 py-1 text-[11px] font-medium text-zinc-200 shadow-lg backdrop-blur transition-all duration-150 hover:border-white/20 hover:bg-zinc-900",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowDown className="size-3" />
      {hint ?? "Jump to latest"}
    </button>
  );
}
