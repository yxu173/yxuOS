"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Custom markdown renderer tuned for the chat panel.
 *
 * - Every block element gets explicit Tailwind styling — we don't depend on
 *   `@tailwindcss/typography`'s `prose`.
 * - Inline elements (strong, em, a, code) inherit color from the parent
 *   message bubble so they always read against the right background — the
 *   user's bubble is light-on-dark text, the agent's is dark-on-light, and
 *   inheriting avoids a hard-coded `text-zinc-100` blending into the wrong
 *   surface.
 * - Long unbreakable strings (URLs, code identifiers) wrap via
 *   `break-words` on the root. We deliberately avoid
 *   `overflow-wrap: anywhere`, which can shred normal prose into one
 *   character per line in a narrow column.
 * - Code, pre, and tables get horizontal scroll instead of breaking the
 *   layout.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-base font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold tracking-tight first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-2 mb-1 text-sm font-medium first:mt-0">{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 ml-5 list-disc space-y-0.5 first:mt-0 last:mb-0 marker:text-current/60">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 ml-5 list-decimal space-y-0.5 first:mt-0 last:mb-0 marker:text-current/60">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 leading-relaxed [&>p]:my-0">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/15 pl-3 italic opacity-80">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <code className="rounded bg-current/10 px-1 py-0.5 font-mono text-[0.85em] text-inherit">
          {children}
        </code>
      );
    }
    return (
      <code className={cn("font-mono text-xs text-inherit", className)}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-zinc-900/80 p-3 text-xs leading-relaxed text-zinc-100">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-current/10">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-current/5 text-left">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-current/5 last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 align-top opacity-90">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-current/10" />,
  strong: ({ children }) => (
    // Browser default for <strong> is bold (700). We force `text-inherit`
    // so the bold prefix never disappears against an unexpected bubble
    // background, and `font-bold` so it visibly contrasts even when the
    // surrounding font has a soft regular weight.
    <strong className="font-bold text-inherit">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-inherit">{children}</em>
  ),
};

export function ChatMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 break-words text-sm leading-relaxed", className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
