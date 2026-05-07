/**
 * Standard result envelope for every client-side canvas tool.
 *
 * Every tool returns either `{ ok: true, data, warnings? }` or
 * `{ ok: false, error: { code, message, hint? } }`. The agent reads `.ok`
 * and reacts — no more `state: "output-error"` for ordinary tool-level
 * failures; that state is now reserved for catastrophic transport
 * problems (e.g. canvas not mounted at all).
 *
 * The Zod schemas on the server side (src/mastra/tools/_envelope.ts) mirror
 * these types — they're the contract advertised to the model.
 */

export const TOOL_ERROR_CODES = [
  "not_found",
  "invalid_input",
  "preconditions_failed",
  "validation_failed",
  "canvas_unavailable",
  "size_limit",
  "internal",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  /** Short, actionable hint the agent can act on without re-asking the user. */
  hint?: string;
}

export type ToolResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: ToolError };

export function ok<T>(data: T, warnings?: string[]): ToolResult<T> {
  return warnings && warnings.length > 0
    ? { ok: true, data, warnings }
    : { ok: true, data };
}

export function fail(
  code: ToolErrorCode,
  message: string,
  hint?: string,
): ToolResult<never> {
  return hint
    ? { ok: false, error: { code, message, hint } }
    : { ok: false, error: { code, message } };
}

/* ─── idempotency ───────────────────────────────────────── */

interface IdemEntry {
  value: unknown;
  expiresAt: number;
}

const IDEMPOTENCY_TTL_MS = 60_000;
const idempotencyCache = new Map<string, IdemEntry>();

function purgeExpired(now: number) {
  for (const [k, v] of idempotencyCache) {
    if (v.expiresAt <= now) idempotencyCache.delete(k);
  }
}

/**
 * If `key` is provided and still cached, return the cached value;
 * otherwise run `fn` and cache the result for ~60 s. Used to short-circuit
 * the rare "model emits the same logical mutation twice" case (page reload
 * mid-stream, network retry surfacing the same logical intent under a new
 * toolCallId, etc.). The AI SDK already deduplicates within a single
 * useChat session by toolCallId — this is a second line of defence keyed
 * on the model's intent.
 */
export function withIdempotency<T>(
  key: string | undefined,
  fn: () => T,
): T {
  if (!key) return fn();
  const now = Date.now();
  purgeExpired(now);
  const hit = idempotencyCache.get(key);
  if (hit) return hit.value as T;
  const value = fn();
  idempotencyCache.set(key, { value, expiresAt: now + IDEMPOTENCY_TTL_MS });
  return value;
}

export async function withIdempotencyAsync<T>(
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn();
  const now = Date.now();
  purgeExpired(now);
  const hit = idempotencyCache.get(key);
  if (hit) return hit.value as T;
  const value = await fn();
  idempotencyCache.set(key, { value, expiresAt: now + IDEMPOTENCY_TTL_MS });
  return value;
}
