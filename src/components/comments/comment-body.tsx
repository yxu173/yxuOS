import { cn } from "@/lib/utils";

// `g` makes split() return the captured group; the matching test below
// uses a non-global twin so we don't have to babysit `lastIndex`.
const MENTION_SPLIT_RE = /(@[a-zA-Z0-9_.]{3,30})/g;
const MENTION_TEST_RE = /^@[a-zA-Z0-9_.]{3,30}$/;

/**
 * Renders a comment body with `@username` mentions highlighted as small
 * pill spans. Plain text otherwise — no markdown, no HTML — so a comment
 * can't break out into headings or lists like a chat reply could.
 */
export function CommentBody({ body }: { body: string }) {
  const parts = body.split(MENTION_SPLIT_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100">
      {parts.map((part, index) =>
        MENTION_TEST_RE.test(part) ? (
          <span
            key={index}
            className={cn(
              "rounded bg-sky-500/15 px-1 py-px font-medium text-sky-200",
            )}
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
