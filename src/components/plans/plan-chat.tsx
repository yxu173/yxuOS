"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, ClipboardList, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/board/chat-markdown";
import { ScrollToBottomPill } from "@/components/chat/scroll-to-bottom-pill";
import {
  ToolPart,
  type ToolUIPartLike,
} from "@/components/chat/tool-part";
import { useChatAutoScroll } from "@/components/chat/use-chat-auto-scroll";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PlanChatProps {
  planId: string;
  initialMessages: UIMessage[];
  initialPrompt?: string;
}

const TOOL_LABELS: Record<string, string> = {
  list_project_boards: "Listing boards",
  read_board: "Reading board",
  search_project_tasks: "Searching tasks",
  read_research_note: "Reading source note",
  list_plan_rows: "Reading plan rows",
  add_plan_row: "Adding row",
  update_plan_row: "Editing row",
  remove_plan_row: "Removing row",
  set_plan_title: "Setting title",
};

/**
 * Right-rail chat for the Planner agent. Same structure as the
 * Researcher's chat (`research-chat.tsx`); different agent, different
 * tools, different accent.
 *
 * `onFinish` triggers `router.refresh()` so the rows panel on the left
 * picks up any add/update/remove the agent did via tools.
 */
export function PlanChat({
  planId,
  initialMessages,
  initialPrompt,
}: PlanChatProps) {
  const [draft, setDraft] = useState("");
  const router = useRouter();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const seededRef = useRef(false);

  const { messages, sendMessage, status, error, stop } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `/api/plan-chat/${planId}`,
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: () => router.refresh(),
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const { containerRef, isAtBottom, onScroll, scrollToBottom } =
    useChatAutoScroll([messages, isStreaming]);

  useEffect(() => {
    if (!initialPrompt) {
      composerRef.current?.focus();
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    sendMessage({ text: initialPrompt });
  }, [initialPrompt, sendMessage]);

  const submit = () => {
    if (isStreaming) return;
    const text = draft.trim();
    if (!text) return;
    sendMessage({ text });
    setDraft("");
  };

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
          <ClipboardList className="size-3.5 text-amber-400" />
          <span>Planner</span>
          <span className="text-[10px] font-normal text-zinc-500">
            · per-project memory
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wide",
            isStreaming
              ? "animate-pulse text-amber-400"
              : "text-zinc-600",
          )}
        >
          {isStreaming ? "thinking…" : "ready"}
        </span>
      </header>

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
        hint={isStreaming ? "Planner is replying ↓" : "Jump to latest"}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-white/5 p-3"
      >
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Describe the goal, refine, push back…"
          className="min-h-[44px] flex-1 resize-none rounded-md border border-white/10 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none"
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
            disabled={draft.trim().length === 0}
            aria-label="Send message"
            title="Send (⌘⏎)"
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
    "Break the auth migration into shippable rows.",
    "Plan the work for adding realtime presence.",
    "Turn this research note into next sprint's backlog.",
  ];
  return (
    <div className="flex flex-col gap-3 pt-8 text-xs text-zinc-500">
      <p className="px-1 text-center text-zinc-400">
        Describe what we&apos;re building. The planner will propose rows you
        can approve and bulk-create as real tasks.
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
        !isUser && !isLast && "border-b border-white/5 pb-4",
      )}
    >
      {!isUser ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <ClipboardList className="size-3" />
          Planner
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
  _input: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
): string | null {
  if (output && output.ok === false && output.error) {
    return `Failed · ${output.error.code}: ${output.error.message}`;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = output && output.ok === true ? output.data : null;
  switch (toolName) {
    case "list_project_boards":
      return data ? `Found ${data.boards?.length ?? 0} board(s)` : null;
    case "read_board":
      return data ? `Read board · ${data.bytes} bytes` : null;
    case "search_project_tasks":
      return data ? `Found ${data.tasks?.length ?? 0} task(s)` : null;
    case "read_research_note":
      return data
        ? `Read source note · ${data.bytes} bytes`
        : null;
    case "list_plan_rows":
      return data ? `Plan has ${data.rows?.length ?? 0} row(s)` : null;
    case "add_plan_row":
      return data ? `Added row at position ${data.position}` : null;
    case "update_plan_row":
      return data ? `Edited row` : null;
    case "remove_plan_row":
      return data ? `Removed row` : null;
    case "set_plan_title":
      return data ? `Title → "${data.title}"` : null;
    default:
      return null;
  }
}
