import { z } from "zod";

/**
 * Server-side Zod schemas for the standard tool result envelope. The
 * client mirrors these as TypeScript types in `src/lib/tool-result.ts`.
 *
 * Filename starts with `_` so the directory's index pattern (if any
 * collects `*.ts`) skips it — these are helpers, not tools.
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

export const toolErrorCodeSchema = z
  .enum(TOOL_ERROR_CODES)
  .describe(
    "Stable error code. Switch on this to decide how to recover: `not_found` → call the relevant `query_*` / `get_*` first; `invalid_input` → fix the args; `validation_failed` → fix the content (e.g. mermaid syntax, design tree shape); `preconditions_failed` → state forbids it (e.g. patching an empty artboard); `canvas_unavailable` → wait or ask the user; `size_limit` → use pagination or summary mode; `internal` → retry once, then fall back.",
  );

export const toolErrorSchema = z.object({
  code: toolErrorCodeSchema,
  message: z.string(),
  hint: z.string().optional(),
});

/**
 * Wrap a data schema in the standard `{ ok: true, data, warnings? }` /
 * `{ ok: false, error }` envelope.
 *
 * We use `z.union` (not `z.discriminatedUnion`) because the data branch
 * carries a generic — discriminated unions in Zod 3 want concrete object
 * shapes per branch and don't compose as cleanly with generics.
 */
export function toolResultSchema<T extends z.ZodTypeAny>(data: T) {
  return z.union([
    z.object({
      ok: z.literal(true),
      data,
      warnings: z
        .array(z.string())
        .optional()
        .describe("Non-fatal notes the agent should consider but doesn't have to act on."),
    }),
    z.object({
      ok: z.literal(false),
      error: toolErrorSchema,
    }),
  ]);
}

/**
 * Optional idempotency key field reused by every mutating tool's input
 * schema. The client maintains an in-memory cache (~60 s TTL) keyed on
 * this string and short-circuits duplicate mutations.
 */
export const idempotencyKeyField = z
  .string()
  .max(120)
  .optional()
  .describe(
    "Optional client-side idempotency key. If you (the model) call the same logical mutation twice with the same key inside ~60 s, the second call returns the cached result instead of double-applying. Use a stable key derived from the user's intent (e.g. `landing-hero-redraw-1`) — not a random uuid.",
  );
