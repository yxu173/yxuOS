"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ScrollToBottomPill } from "@/components/chat/scroll-to-bottom-pill";
import {
  ToolPart,
  type ToolUIPartLike,
} from "@/components/chat/tool-part";
import { useChatAutoScroll } from "@/components/chat/use-chat-auto-scroll";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  executeAddMarkdownCard,
  executeAddMermaidCard,
  executeAddShapes,
  executeDeleteShapes,
  executeQueryCanvas,
  executeUpdateShapes,
} from "./canvas-tools";
import { ChatMarkdown } from "./chat-markdown";
import { useBoardEditorRef } from "./editor-context";

export interface ChatProps {
  boardId: string;
  initialMessages?: UIMessage[];
}

const TOOL_LABELS: Record<string, string> = {
  query_canvas: "Reading canvas",
  add_shapes: "Drawing shapes",
  update_shapes: "Updating shapes",
  delete_shapes: "Deleting shapes",
  add_markdown_card: "Writing note",
  add_mermaid_card: "Drawing diagram",
};

export function Chat({ boardId, initialMessages }: ChatProps) {
  const editorRef = useBoardEditorRef();
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const { messages, sendMessage, status, error, addToolOutput, stop } = useChat(
    {
      messages: initialMessages,
      transport: new DefaultChatTransport({
        api: `/api/chat/${boardId}`,
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      async onToolCall({ toolCall }) {
        if (toolCall.dynamic) return;

        const editor = editorRef.current;
        if (!editor) {
          addToolOutput({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool: toolCall.toolName as any,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText:
              "Canvas isn't ready yet. Try again in a second once the whiteboard finishes loading.",
          });
          return;
        }

        try {
          switch (toolCall.toolName) {
            case "query_canvas": {
              const output = executeQueryCanvas(editor);
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "add_shapes": {
              const output = executeAddShapes(
                editor,
                toolCall.input as Parameters<typeof executeAddShapes>[1],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "update_shapes": {
              const output = executeUpdateShapes(
                editor,
                toolCall.input as Parameters<typeof executeUpdateShapes>[1],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "delete_shapes": {
              const output = executeDeleteShapes(
                editor,
                toolCall.input as Parameters<typeof executeDeleteShapes>[1],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "add_markdown_card": {
              const output = executeAddMarkdownCard(
                editor,
                toolCall.input as Parameters<typeof executeAddMarkdownCard>[1],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "add_mermaid_card": {
              const output = await executeAddMermaidCard(
                editor,
                toolCall.input as Parameters<typeof executeAddMermaidCard>[1],
              );
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            default: {
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Unknown tool: ${toolCall.toolName}`,
              });
            }
          }
        } catch (err) {
          addToolOutput({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool: toolCall.toolName as any,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: err instanceof Error ? err.message : "Tool failed",
          });
        }
      },
    },
  );

  const isStreaming = status === "streaming" || status === "submitted";

  // Smart auto-scroll: pin to bottom only while the user is already there.
  const { containerRef, isAtBottom, onScroll, scrollToBottom } =
    useChatAutoScroll([messages, isStreaming]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

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
    <section className="relative flex h-full w-96 min-w-0 shrink-0 flex-col overflow-hidden border-l border-white/5 bg-zinc-950/40 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Chat
        </h2>
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

      <div
        ref={containerRef}
        onScroll={onScroll}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="flex min-w-0 flex-col gap-5 px-3 py-4">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
              />
            ))
          )}
          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 break-words">
              {error.message ?? "Something went wrong."}
            </p>
          ) : null}
        </div>
      </div>

      <ScrollToBottomPill
        visible={!isAtBottom}
        onClick={() => scrollToBottom()}
        hint={isStreaming ? "Agent is replying ↓" : "Jump to latest"}
      />

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
          placeholder="Ask the agent…"
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
    </section>
  );
}

function EmptyState() {
  const examples = [
    "Draw a 3-layer architecture for a SaaS app.",
    "Sketch the OAuth login flow.",
    "Write a markdown card explaining JWT vs sessions.",
    "Make an ERD for users, posts, comments.",
  ];
  return (
    <div className="flex flex-col gap-3 pt-12 text-xs text-zinc-500">
      <p className="px-1 text-center text-zinc-400">
        Ask the agent to draw a system, write a description, or sketch an
        architecture.
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

function MessageRow({
  message,
  isLast,
}: {
  message: UIMessage;
  isLast: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex min-w-0",
        isUser ? "justify-end" : "flex-col items-stretch",
        // Hairline separator between consecutive agent messages.
        !isUser && !isLast && "border-b border-white/5 pb-4",
      )}
    >
      {!isUser ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <Sparkles className="size-3" />
          Architect
        </div>
      ) : null}
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
            return (
              <ToolPart
                key={index}
                part={part as ToolUIPartLike}
                labels={TOOL_LABELS}
                describe={describeToolResult}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

function describeToolResult(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
): string | null {
  switch (toolName) {
    case "query_canvas":
      return output && Array.isArray(output.shapes)
        ? `Read canvas (${output.shapes.length} shape${
            output.shapes.length === 1 ? "" : "s"
          })`
        : "Read canvas";
    case "add_shapes":
      return output && Array.isArray(output.createdShapeIds)
        ? `Drew ${output.createdShapeIds.length} shape${
            output.createdShapeIds.length === 1 ? "" : "s"
          }`
        : "Drew shapes";
    case "update_shapes":
      return output && Array.isArray(output.updatedShapeIds)
        ? `Updated ${output.updatedShapeIds.length} shape${
            output.updatedShapeIds.length === 1 ? "" : "s"
          }`
        : "Updated shapes";
    case "delete_shapes":
      return output && Array.isArray(output.deletedShapeIds)
        ? `Deleted ${output.deletedShapeIds.length} shape${
            output.deletedShapeIds.length === 1 ? "" : "s"
          }`
        : "Deleted shapes";
    case "add_markdown_card":
      return "Wrote a markdown card";
    case "add_mermaid_card":
      return input && typeof input.kind === "string"
        ? `Drew a ${input.kind} diagram`
        : "Drew a diagram";
    default:
      return null;
  }
}
