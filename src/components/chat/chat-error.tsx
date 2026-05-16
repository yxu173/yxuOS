"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { classifyChatError } from "@/lib/ai/friendly-error";

/**
 * Friendly chat-error pill, shared across every agent sidebar.
 *
 * `useChat`'s `error` carries a single `message` string. In the
 * happy path that string is already friendly (server-side
 * `safeChatStream` has classified it before emitting). But the
 * helper still does its own classification client-side so:
 *
 *   1. Old deployments / cached service workers that pre-date the
 *      server fix still produce a clean pill.
 *   2. Errors thrown *outside* the stream (transport / network /
 *      auth) take the same code path.
 *   3. The pill can render kind-specific affordances (a "retry"
 *      button on transient failures, no button on permanent
 *      auth failures, a wait hint on rate-limits).
 */
export function ChatError({
  error,
  onRetry,
  isRetrying = false,
}: {
  error: Error | { message?: string };
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const friendly = classifyChatError(error);

  // Retry button is shown for everything *except* unauthorized —
  // retrying an unauthenticated request just produces the same
  // failure. Rate-limited / timeout / transport all benefit from a
  // user-driven retry.
  const showRetry = friendly.kind !== "unauthorized" && Boolean(onRetry);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      <p className="break-words">{friendly.message}</p>
      {showRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="inline-flex w-fit items-center gap-1 rounded border border-red-500/40 px-2 py-0.5 text-[11px] font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          {isRetrying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {isRetrying ? "Retrying…" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}
