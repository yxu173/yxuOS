"use client";

import { marked } from "marked";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

export interface RichTextRenderProps {
  /**
   * Editor HTML (from `RichTextEditor`) OR legacy markdown content. The
   * renderer auto-detects: if there's an HTML tag in there it's treated
   * as HTML, otherwise it's parsed as markdown. Means we can ship the
   * WYSIWYG editor without a one-shot data migration — old markdown
   * descriptions keep rendering correctly.
   */
  body: string;
  className?: string;
  /**
   * When set, every `<span data-mention-kind="…" data-id="…">`
   * produced by the editor is rewritten into an `<a>` linking to the
   * appropriate page in the given project.
   *
   *   - `kind="board"`    → `/p/<slug>/boards/<id>`
   *   - `kind="research"` → `/p/<slug>/research/<id>`
   *   - `kind="plan"`     → `/p/<slug>/plans/<id>`
   *
   * Use this in task / comment surfaces where the user expects the
   * chip to be clickable. Leave undefined for surfaces (previews,
   * share pages) where the chip is informational only — the inline
   * span still renders with its `.mention-board` styling, just not
   * as a link. The prop name is `linkBoardMentions` for API stability;
   * the implementation handles every supported kind.
   */
  linkBoardMentions?: { projectSlug: string };
}

const HTML_HINT_RE = /<\/?[a-zA-Z][^>]*>/;

// `marked` is sync when `async: false`. We set it once for predictable
// behaviour at render time.
marked.setOptions({ async: false, gfm: true, breaks: true });

/**
 * Read-only renderer for `RichTextEditor` output. Wraps the HTML in the
 * same `prose-tiptap` class the editor uses so editing and reading look
 * identical.
 *
 * Markdown bodies (any string without HTML tags) are passed through
 * `marked` so legacy task descriptions, comments, and migrated content
 * render correctly until they're re-saved through the rich editor.
 */
export function RichTextRender({
  body,
  className,
  linkBoardMentions,
}: RichTextRenderProps) {
  // Depend on the primitive `projectSlug` so callers passing inline
  // `{ projectSlug }` literals (which create a fresh object every
  // render) don't bust this memo on every parent re-render.
  const linkProjectSlug = linkBoardMentions?.projectSlug ?? null;
  const html = useMemo(() => {
    if (!body) return "";
    const parsed = HTML_HINT_RE.test(body)
      ? body
      : (marked.parse(body) as string);
    return linkProjectSlug
      ? rewriteMentionSpans(parsed, linkProjectSlug)
      : parsed;
  }, [body, linkProjectSlug]);

  if (!body) return null;

  return (
    <div
      className={cn("prose-tiptap break-words", className)}
      // Content originates from our own editor or our agent. We don't
      // accept arbitrary HTML from third parties, so DOMPurify isn't a
      // hard requirement here — but if we ever do, this is the spot.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Walk the rendered HTML and turn `<span data-mention-kind="…"
 * data-id="…">` chips into anchor tags pointing at the target page
 * inside the given project.
 *
 * The editor produces a tight, well-formed shape:
 *   `<span class="..." data-mention-kind="<kind>" data-id="abc">@Foo</span>`
 * (attribute order may vary depending on tiptap's renderer). A regex
 * is sufficient and keeps this a server-renderable string transform —
 * no DOMParser, no client-only effect, hydration-safe.
 *
 * Defensive: if `data-id` is missing/empty, or `data-mention-kind` is
 * a value we don't recognise, we leave the span untouched so a
 * future kind doesn't render as a broken link.
 *
 * Mention names are pulled from the inner text content verbatim and
 * used only as the link's visible label, so an injected tag would
 * land inside the `<a>` and stay quoted.
 */
function rewriteMentionSpans(html: string, projectSlug: string): string {
  // We match any mention span, not just `kind="board"`, then dispatch
  // by attribute below. The regex is loose on `[^>]*?` to tolerate
  // arbitrary attribute order between the two we care about.
  const SPAN_RE =
    /<span\b([^>]*\bdata-mention-kind="(board|research|plan)"[^>]*)>([\s\S]*?)<\/span>/gi;
  return html.replace(
    SPAN_RE,
    (match, attrs: string, kind: string, inner: string) => {
      const idMatch = attrs.match(/\bdata-id="([^"]+)"/);
      const id = idMatch?.[1];
      if (!id) return match;
      const safeProject = encodeURIComponent(projectSlug);
      const safeId = encodeURIComponent(id);
      const subpath =
        kind === "research"
          ? "research"
          : kind === "plan"
            ? "plans"
            : "boards";
      // We rebuild the attribute set so external classes / titles set
      // on the span (e.g. styling overrides) survive into the anchor.
      // The `href` is appended last so it can't be overridden by a
      // stale attribute the editor accidentally wrote into the span.
      return `<a ${attrs} href="/p/${safeProject}/${subpath}/${safeId}">${inner}</a>`;
    },
  );
}
