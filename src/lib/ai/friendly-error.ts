/**
 * Friendly-error classifier for AI streaming endpoints.
 *
 * The AI SDK serialises upstream provider failures as JSON-shaped
 * `AI_APICallError` payloads — useful for debugging in dev, but a
 * brick of text in the user's chat sidebar in prod. This helper
 * inspects an arbitrary thrown / streamed error and returns a
 * short, plain-English message we're happy to put under the user's
 * message bubble.
 *
 * Used in three places:
 *
 *   1. Server-side, via `safeChatStream()` (the `onError` hook on
 *      `createUIMessageStream`) — replaces the upstream rejection's
 *      payload with the friendly string before it leaves the route.
 *
 *   2. Client-side, via `formatChatError()` (a thin wrapper), so any
 *      error that *still* slips through (older deployment hitting a
 *      newer client, transport-level failures the SDK throws after
 *      the stream is established, etc.) gets the same treatment.
 *
 *   3. In tests, for asserting specific failure paths.
 *
 * Heuristics are intentionally generous: we'd rather catch an error
 * we've never seen and produce a generic-but-clean message than let
 * a stack trace through.
 */

/** Stable error kinds — used by the UI to pick an icon / tone. */
export type FriendlyErrorKind =
  | "rate_limited"
  | "unauthorized"
  | "timeout"
  | "transport"
  | "model"
  | "unknown";

export interface FriendlyError {
  kind: FriendlyErrorKind;
  /** Short, plain-English user-facing message. No JSON, no stack. */
  message: string;
  /**
   * When the upstream told us how long to back off (Retry-After or
   * the AI SDK's `retry-after-ms`), this carries that value in
   * milliseconds so the UI can render "try again in 3s".
   */
  retryAfterMs?: number;
}

/** Classify an unknown error into a `FriendlyError`. Never throws. */
export function classifyChatError(error: unknown): FriendlyError {
  // The streamed payload from the AI SDK arrives as a string most of
  // the time — sometimes a JSON-encoded `AI_APICallError`, sometimes
  // a bare message. Normalise both into a probing object.
  const probe = toErrorProbe(error);

  // ── Rate limit ─────────────────────────────────────────────────
  if (isRateLimited(probe)) {
    const retryAfterMs = pickRetryAfterMs(probe);
    const wait = retryAfterMs
      ? secondsToHumanWait(retryAfterMs)
      : "a few seconds";
    return {
      kind: "rate_limited",
      message: `The AI is at capacity. Try again in ${wait}.`,
      retryAfterMs,
    };
  }

  // ── Auth ───────────────────────────────────────────────────────
  if (probe.status === 401 || probe.status === 403) {
    return {
      kind: "unauthorized",
      message:
        "The AI provider rejected the request. An admin needs to check the API key.",
    };
  }

  // ── Timeouts ───────────────────────────────────────────────────
  if (
    probe.name === "AbortError" ||
    /timeout/i.test(probe.name ?? "") ||
    /timeout/i.test(probe.message ?? "")
  ) {
    return {
      kind: "timeout",
      message: "The AI took too long to respond. Send again.",
    };
  }

  // ── Transport: 5xx, fetch failures ─────────────────────────────
  if (
    (typeof probe.status === "number" && probe.status >= 500) ||
    /fetch failed|ECONNRESET|ENOTFOUND|network/i.test(probe.message ?? "")
  ) {
    return {
      kind: "transport",
      message:
        "Couldn't reach the AI provider. This usually clears up on its own — try again.",
    };
  }

  // ── Known-bad model state ──────────────────────────────────────
  if (
    probe.name === "AI_NoObjectGeneratedError" ||
    probe.name === "AI_NoSuchToolError" ||
    /invalid.*tool|tool.*not found/i.test(probe.message ?? "")
  ) {
    return {
      kind: "model",
      message:
        "The AI got into a bad state mid-reply. Try sending your message again.",
    };
  }

  // ── Fallback ───────────────────────────────────────────────────
  return {
    kind: "unknown",
    // Surface the bare message if it's reasonably short and not JSON.
    // Anything that looks like a serialised error blob collapses to
    // the generic message — better one boring line than a wall of
    // implementation detail.
    message: pickFallbackMessage(probe.message),
  };
}

/**
 * Convert a `FriendlyError` to the single string we emit on the
 * stream (used by the `onError` hook on `createUIMessageStream`).
 *
 * Format: plain message. The UI augments it with kind-specific
 * styling via the parser on the client side.
 */
export function toErrorText(error: unknown): string {
  return classifyChatError(error).message;
}

/* ─── internals ─────────────────────────────────────────── */

interface ErrorProbe {
  name?: string;
  message?: string;
  status?: number;
  retryAfterMs?: number;
  // Free-form catch-all for header / body fields we want to inspect
  // without a strict type.
  raw?: Record<string, unknown>;
}

/**
 * Coerce an arbitrary thrown value into something we can probe
 * uniformly. The AI SDK throws `AI_APICallError` (an Error subclass
 * with `statusCode`, `responseHeaders`, `responseBody` props) and
 * sometimes JSON-stringified copies of the same when piped through
 * the stream — we cover both.
 */
function toErrorProbe(error: unknown): ErrorProbe {
  if (!error) return {};
  // Maybe an Error subclass with rich props (AI_APICallError).
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const probe: ErrorProbe = {
      name: typeof obj.name === "string" ? obj.name : undefined,
      message: typeof obj.message === "string" ? obj.message : undefined,
      status:
        typeof obj.statusCode === "number"
          ? obj.statusCode
          : typeof obj.status === "number"
            ? obj.status
            : undefined,
      raw: obj,
    };
    // AI SDK 429 errors carry the parsed retry-after-ms in either
    // `responseHeaders["retry-after-ms"]` or directly in the body.
    const headers = obj.responseHeaders as Record<string, string> | undefined;
    if (headers && typeof headers["retry-after-ms"] === "string") {
      const n = Number.parseInt(headers["retry-after-ms"], 10);
      if (Number.isFinite(n)) probe.retryAfterMs = n;
    }
    if (
      probe.retryAfterMs === undefined &&
      headers &&
      typeof headers["retry-after"] === "string"
    ) {
      const n = Number.parseInt(headers["retry-after"], 10);
      // Retry-After is seconds.
      if (Number.isFinite(n)) probe.retryAfterMs = n * 1000;
    }
    return probe;
  }
  // Plain string — could be a JSON-stringified Error, or a bare msg.
  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed.startsWith("{")) {
      try {
        return toErrorProbe(JSON.parse(trimmed));
      } catch {
        /* fall through */
      }
    }
    return { message: trimmed };
  }
  return {};
}

/**
 * Detect rate-limit responses across providers / shapes:
 *
 *  - HTTP 429 anywhere on the probe
 *  - `name === "AI_RateLimitError"` (AI SDK normalised)
 *  - Body containing "Rate limit" or "RateLimitReached"
 */
function isRateLimited(probe: ErrorProbe): boolean {
  if (probe.status === 429) return true;
  if (probe.name === "AI_RateLimitError") return true;
  const msg = probe.message ?? "";
  if (/rate limit|RateLimitReached|too many requests/i.test(msg)) return true;
  // AI_APICallError's `message` is often "Too Many Requests" plus a
  // JSON body in `responseBody`; check the raw body too.
  const body = probe.raw?.responseBody;
  if (typeof body === "string" && /RateLimitReached|rate limit/i.test(body)) {
    return true;
  }
  return false;
}

function pickRetryAfterMs(probe: ErrorProbe): number | undefined {
  if (typeof probe.retryAfterMs === "number") return probe.retryAfterMs;
  return undefined;
}

function secondsToHumanWait(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s <= 1) return "a moment";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return `${m}m`;
}

/**
 * Pick a fallback message for unknown errors. We never reveal a JSON
 * blob — if the input is obviously serialised, collapse to a generic.
 */
function pickFallbackMessage(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again.";
  const looksLikeJson = /^\s*[{[]/.test(message);
  if (looksLikeJson) return "Something went wrong. Try again.";
  // Cap at one sentence / 200 chars so we never leak a stack.
  const trimmed = message.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : "Something went wrong. Try again.";
}
