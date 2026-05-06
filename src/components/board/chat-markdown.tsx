"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Custom markdown renderer tuned for the chat panel.
 *
 * - Every block element gets explicit Tailwind styling — we don't depend on
 *   `@tailwindcss/typography`'s `prose`.
 * - Long unbreakable strings (URLs, code identifiers) wrap via
 *   `[overflow-wrap:anywhere]` on the root.
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
    <ul className="my-1.5 ml-4 list-disc space-y-0.5 first:mt-0 last:mb-0 marker:text-zinc-500">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 first:mt-0 last:mb-0 marker:text-zinc-500">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-white/15 pl-3 italic text-zinc-400">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-zinc-100">
          {children}
        </code>
      );
    }
    return (
      <code className={cn("font-mono text-xs", className)}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-zinc-900/80 p-3 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-white/10">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-white/5 text-left">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-white/5 last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 font-medium text-zinc-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 align-top text-zinc-300">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-300 underline underline-offset-2 hover:text-blue-200"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
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
      className={cn(
        "min-w-0 text-sm [overflow-wrap:anywhere] [&_*]:min-w-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
