import { MarkdownProse } from "@/components/markdown/markdown-prose";

// `g` makes split() return the captured group; the matching test below
// uses a non-global twin so we don't have to babysit `lastIndex`.
const MENTION_SPLIT_RE = /(@[a-zA-Z0-9_.]{3,30})/g;
const MENTION_TEST_RE = /^@[a-zA-Z0-9_.]{3,30}$/;
// Anything that smells like markdown: image / link / fenced code / inline
// formatting. We use this to decide whether a comment needs the full
// markdown renderer or can stay as the simple plain-text + mention pill
// view (which is faster and keeps mentions visually distinct).
const MARKDOWN_HINT_RE =
  /!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|```|\n[*-] |\n#{1,6} |[*_]{2}[^*_\n]+[*_]{2}/;

export interface CommentBodyProps {
  body: string;
}

/**
 * Renders a comment body intelligently:
 *
 * - If the body contains markdown features (images, links, code blocks,
 *   bold, lists, headings) it renders through {@link MarkdownProse} so
 *   pasted screenshots become real images.
 * - Otherwise it stays as plain text with `@username` mention pills —
 *   keeps mentions visually distinct, which most short comments are.
 */
export function CommentBody({ body }: CommentBodyProps) {
  if (MARKDOWN_HINT_RE.test(body)) {
    return <MarkdownProse>{body}</MarkdownProse>;
  }

  const parts = body.split(MENTION_SPLIT_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100">
      {parts.map((part, index) =>
        MENTION_TEST_RE.test(part) ? (
          <span
            key={index}
            className="rounded bg-sky-500/15 px-1 py-px font-medium text-sky-200"
          >
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}
