"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Prose-tuned markdown renderer. Used for task descriptions, knowledge
 * documents, anything that's longer-form than a chat reply. Ships its
 * own component overrides (more breathing room, bigger headings, real
 * image rendering with rounded borders) — distinct from `ChatMarkdown`,
 * which is squeezed into a 380-px sidebar.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-lg font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-base font-semibold first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 ml-5 list-disc space-y-1 first:mt-0 last:mb-0 marker:text-current/60">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0 marker:text-current/60">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed [&>p]:my-0">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-current/20 pl-3 italic opacity-80">
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
    <pre className="my-3 overflow-x-auto rounded-md bg-zinc-900/80 p-3 text-xs leading-relaxed text-zinc-100">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-current/10">
      <table className="w-full border-collapse text-sm">{children}</table>
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
    <th className="px-2 py-1.5 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1.5 align-top opacity-90">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-sky-300 underline underline-offset-2 hover:text-sky-200"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-4 border-current/10" />,
  strong: ({ children }) => (
    <strong className="font-bold text-inherit">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-inherit">{children}</em>,
  img: ({ src, alt }) => (
    <a
      href={typeof src === "string" ? src : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="my-3 block w-fit max-w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-900"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={typeof src === "string" ? src : ""}
        alt={alt ?? ""}
        className="block max-h-[60vh] max-w-full object-contain"
        loading="lazy"
      />
    </a>
  ),
};

export interface MarkdownProseProps {
  children: string;
  className?: string;
}

export function MarkdownProse({ children, className }: MarkdownProseProps) {
  return (
    <div
      className={cn(
        "min-w-0 break-words text-sm leading-relaxed text-zinc-200",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
