"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export interface ToolUIPartLike {
  type: string;
  state?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
  errorText?: string;
}

export type ToolDescriber = (
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
) => string | null;

export interface ToolPartProps {
  part: ToolUIPartLike;
  /**
   * Human label for `tool-<name>` (e.g. `add_shapes` → `Drawing shapes`).
   * Falls back to the raw tool name when unset.
   */
  labels?: Record<string, string>;
  /**
   * Build a "Drew 3 shapes" / "Patched hero · backgroundColor" style
   * sentence for completed calls. Returning `null` falls back to the
   * default label.
   */
  describe?: ToolDescriber;
}

/**
 * Compact, expandable tool-call pill rendered inside a chat message.
 *
 * - Streaming: animated loader, label with `…`.
 * - Done: green tick + a one-line summary; clicking expands to reveal
 *   the input args (and any small output payload) for debugging.
 * - Error: red triangle + the full error text wraps below; the agent's
 *   system prompt asks it to retry on its own.
 */
export function ToolPart({ part, labels, describe }: ToolPartProps) {
  const [expanded, setExpanded] = useState(false);
  const toolName = part.type.replace(/^tool-/, "");
  const label = labels?.[toolName] ?? toolName;

  let icon = <Sparkles className="size-3.5" />;
  let body: React.ReactNode = label;
  let tone = "border-white/10 bg-white/5 text-zinc-300";
  let isStreaming = false;
  let isError = false;

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      icon = <Loader2 className="size-3.5 animate-spin" />;
      body = `${label}…`;
      isStreaming = true;
      break;
    case "output-available":
      icon = <CheckCircle2 className="size-3.5" />;
      body = describe?.(toolName, part.input, part.output) ?? label;
      tone = "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
      break;
    case "output-error":
      icon = <TriangleAlert className="size-3.5" />;
      body = `${label} failed`;
      tone = "border-red-500/30 bg-red-500/10 text-red-200";
      isError = true;
      break;
  }

  // Errors auto-expand so the user always sees the failure reason.
  const showDetails = expanded || isError;
  const canExpand = !isStreaming && (part.input || isError || part.output);

  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-md border text-xs", tone)}
      role="status"
    >
      <button
        type="button"
        onClick={() => {
          if (!canExpand) return;
          setExpanded((v) => !v);
        }}
        disabled={!canExpand}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          canExpand
            ? "cursor-pointer hover:bg-current/5"
            : "cursor-default",
        )}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {icon}
        <span className="flex-1 truncate">{body}</span>
        {canExpand && !isError ? (
          showDetails ? (
            <ChevronDown className="size-3 opacity-60" />
          ) : (
            <ChevronRight className="size-3 opacity-60" />
          )
        ) : null}
      </button>

      {showDetails ? (
        <div className="space-y-2 border-t border-current/10 px-2.5 py-2">
          {isError && part.errorText ? (
            <Block label="Error" tone="error">
              {part.errorText}
            </Block>
          ) : null}
          {part.input ? (
            <Block label="Input">{stringify(part.input)}</Block>
          ) : null}
          {part.output && !isError ? (
            <Block label="Output">{stringify(part.output)}</Block>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Block({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          "text-[9px] font-semibold uppercase tracking-wide opacity-60",
          tone === "error" ? "text-red-200" : null,
        )}
      >
        {label}
      </span>
      <pre className="chat-scroll max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stringify(value: any): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
