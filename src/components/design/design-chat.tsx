"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  ArrowUp,
  CheckCircle2,
  Loader2,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/board/chat-markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  executeAddArtboard,
  executeDeleteArtboard,
  executeGetArtboard,
  executeListComponents,
  executeQueryCanvas,
  executeUpdateArtboard,
} from "./canvas-tools";
import { useComponentLibrary } from "./component-library-context";

export interface DesignChatProps {
  designId: string;
  initialMessages?: UIMessage[];
}

const TOOL_LABELS: Record<string, string> = {
  query_canvas: "Reading canvas",
  add_artboard: "Drawing artboard",
  update_artboard: "Updating artboard",
  delete_artboard: "Deleting artboard",
  get_artboard: "Reading artboard",
  list_components: "Reading component library",
};

/**
 * Chat panel for the design agent (right side of the design canvas).
 *
 * Mirrors the board chat in shape — same composer, same scroll, same
 * markdown — but points at /api/design-chat/[designId] and dispatches
 * the design canvas tools (add_artboard / update_artboard / etc.) into
 * the zustand store via `onToolCall`.
 */
export function DesignChat({ designId, initialMessages }: DesignChatProps) {
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const library = useComponentLibrary();

  const { messages, sendMessage, status, error, addToolOutput, stop } =
    useChat({
      messages: initialMessages,
      transport: new DefaultChatTransport({
        api: `/api/design-chat/${designId}`,
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      async onToolCall({ toolCall }) {
        if (toolCall.dynamic) return;

        const reportError = (errorText: string) => {
          addToolOutput({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool: toolCall.toolName as any,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText,
          });
        };

        try {
          switch (toolCall.toolName) {
            case "query_canvas": {
              const output = executeQueryCanvas();
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "add_artboard": {
              const output = executeAddArtboard(
                toolCall.input as Parameters<typeof executeAddArtboard>[0],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "update_artboard": {
              const output = executeUpdateArtboard(
                toolCall.input as Parameters<typeof executeUpdateArtboard>[0],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "delete_artboard": {
              const output = executeDeleteArtboard(
                toolCall.input as Parameters<typeof executeDeleteArtboard>[0],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "get_artboard": {
              const output = executeGetArtboard(
                toolCall.input as Parameters<typeof executeGetArtboard>[0],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "list_components": {
              const output = executeListComponents(library.list);
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            default:
              reportError(`Unknown tool: ${toolCall.toolName}`);
          }
        } catch (err) {
          reportError(err instanceof Error ? err.message : "Tool failed");
        }
      },
    });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInput("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center justify-end border-b border-white/5 px-3 py-1.5">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wide",
            isStreaming
              ? "animate-pulse text-emerald-400"
              : "text-zinc-600",
          )}
        >
          {isStreaming ? "thinking…" : "ready"}
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex min-w-0 flex-col gap-4 px-3 py-3">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))
          )}
          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 [overflow-wrap:anywhere]">
              {error.message ?? "Something went wrong."}
            </p>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-white/5 p-3"
      >
        <Textarea
          ref={composerRef}
          rows={1}
          placeholder="Describe what to design…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-40 min-h-9 resize-none bg-zinc-900/80 text-sm"
        />
        {isStreaming ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={() => stop()}
            aria-label="Stop generating"
            title="Stop"
          >
            <Square className="size-3.5" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim()}
            aria-label="Send message"
            title="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function EmptyState() {
  const examples = [
    "Make a landing page for a SaaS analytics product called Stride.",
    "Sketch a settings screen with three tabs: Profile, Billing, API keys.",
    "Design a mobile checkout flow — three screens.",
    "Draft a pricing page with three tiers and a comparison table.",
  ];
  return (
    <div className="flex flex-col gap-3 pt-12 text-xs text-zinc-500">
      <p className="px-1 text-center text-zinc-400">
        Tell the agent what to design and it&apos;ll mock it up on the
        canvas.
      </p>
      <ul className="flex flex-col gap-1.5 pt-2">
        {examples.map((example) => (
          <li
            key={example}
            className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-zinc-400"
          >
            {example}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex min-w-0",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 text-sm leading-relaxed",
          isUser
            ? "max-w-[88%] rounded-2xl bg-zinc-100 px-3.5 py-2 text-zinc-900"
            : "w-full text-zinc-100",
        )}
      >
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <ChatMarkdown
                key={index}
                className={isUser ? "text-zinc-900" : "text-zinc-100"}
              >
                {part.text}
              </ChatMarkdown>
            );
          }
          if (part.type.startsWith("tool-")) {
            return <ToolPart key={index} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

interface ToolUIPartLike {
  type: string;
  state?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
  errorText?: string;
}

function ToolPart({ part }: { part: ToolUIPartLike }) {
  const toolName = part.type.replace(/^tool-/, "");
  const label = TOOL_LABELS[toolName] ?? toolName;

  let icon = <Sparkles className="size-3.5" />;
  let body: React.ReactNode = label;
  let tone = "border-white/10 bg-white/5 text-zinc-300";

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      icon = <Loader2 className="size-3.5 animate-spin" />;
      body = `${label}…`;
      break;
    case "output-available":
      icon = <CheckCircle2 className="size-3.5" />;
      body = describeToolResult(toolName, part.input) ?? label;
      tone = "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
      break;
    case "output-error":
      icon = <TriangleAlert className="size-3.5" />;
      body = part.errorText ?? `${label} failed`;
      tone = "border-red-500/30 bg-red-500/10 text-red-200";
      break;
    default:
      break;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        tone,
      )}
      role="status"
    >
      {icon}
      <span className="truncate">{body}</span>
    </div>
  );
}

function describeToolResult(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
): string | null {
  switch (toolName) {
    case "query_canvas":
      return "Read canvas";
    case "add_artboard":
      return input?.name
        ? `Added artboard "${input.name}"`
        : "Added artboard";
    case "update_artboard":
      return "Updated artboard";
    case "delete_artboard":
      return "Removed artboard";
    case "get_artboard":
      return "Read artboard";
    case "list_components":
      return "Read component library";
    default:
      return null;
  }
}
