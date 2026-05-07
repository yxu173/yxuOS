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
export function RichTextRender({ body, className }: RichTextRenderProps) {
  const html = useMemo(() => {
    if (!body) return "";
    return HTML_HINT_RE.test(body) ? body : (marked.parse(body) as string);
  }, [body]);

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
