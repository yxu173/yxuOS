/**
 * One-line, terminal-friendly error formatter for the RAG layer.
 *
 * Why this exists: the Vercel AI SDK throws `AI_APICallError` with
 * an enormous `requestBodyValues` field — when an indexer fails on
 * an upstream 401/429, dumping the whole error object floods the
 * terminal with the entire embed payload (10+ KB per chunk). At
 * backfill time with hundreds of artifacts this makes the log
 * effectively unreadable.
 *
 * `formatRagError` returns a short, debuggable summary:
 *
 *   AI_APICallError 401 https://...: Access denied due to invalid …
 *
 * For non-AI-SDK errors it falls back to `err.message`, then
 * `String(err)`. The full error is still available via `--verbose`
 * (`process.env.RAG_VERBOSE_ERRORS`), so debugging a tricky payload
 * issue is one env var away.
 */

interface ApiCallErrorLike {
  name?: string;
  statusCode?: number;
  url?: string;
  message?: string;
}

export function formatRagError(err: unknown): string {
  if (process.env.RAG_VERBOSE_ERRORS) {
    // Full dump for hard-to-reproduce errors. The default path is
    // the friendlier one above.
    return String(err);
  }

  if (err && typeof err === "object") {
    const e = err as ApiCallErrorLike;
    const status = e.statusCode ? ` ${e.statusCode}` : "";
    const url = e.url ? ` ${truncateUrl(e.url)}` : "";
    const name = e.name ?? "Error";
    const msg = e.message?.split("\n")[0] ?? "";
    return `${name}${status}${url}: ${msg}`;
  }
  return String(err);
}

/**
 * Trim long URLs for log readability. Keeps origin + path; drops
 * query strings (api-version, etc.) which are noise in error lines.
 */
function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.length > 80 ? `${url.slice(0, 77)}…` : url;
  }
}
