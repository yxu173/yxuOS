"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, FileText, Microscope, Square } from "lucide-react";
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

export interface ResearchChatProps {
  noteId: string;
  /**
   * Messages persisted in the agent's thread, hydrated from Mastra
   * memory on the server. Empty for a brand-new note.
   */
  initialMessages: UIMessage[];
  /**
   * Optional first prompt — when provided (e.g. the index page passed
   * `?ask=...` after creating a fresh note), the chat auto-sends it
   * once on mount so the user lands mid-conversation instead of on a
   * blank composer.
   */
  initialPrompt?: string;
}

/**
 * Right-rail chat for the Researcher agent.
 *
 * Same shape as the design chat, simpler insides:
 *   - No client-side tool dispatch — every researcher tool runs
 *     server-side (see `src/mastra/tools/research-workspace.ts`).
 *   - No pinned elements, no canvas integration.
 *   - The note body lives in the LEFT pane (`ResearchNoteEditor`);
 *     when the agent calls `update_research_note`, we kick a
 *     `router.refresh()` so the editor picks up the new content.
 */
const TOOL_LABELS: Record<string, string> = {
  list_project_boards: "Listing boards",
  read_board: "Reading board",
  list_project_designs: "Listing designs",
  search_project_tasks: "Searching tasks",
  list_recent_research_notes: "Reading prior notes",
  update_research_note: "Writing into note",
  web_search: "Searching the web",
};

export function ResearchChat({
  noteId,
  initialMessages,
  initialPrompt,
}: ResearchChatProps) {
  const [draft, setDraft] = useState("");
  const router = useRouter();
  // The composer focuses itself on first render, but only when there
  // ISN'T an initial prompt — otherwise we'd snap focus to an empty
  // input the user is about to see auto-fill.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Tracks whether we've already auto-sent the seeded prompt — guards
  // against double-fires from React 19 strict mode.
  const seededRef = useRef(false);

  const { messages, sendMessage, status, error, stop } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `/api/research-chat/${noteId}`,
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Whenever the agent finishes a turn, refresh server data so any
    // `update_research_note` tool call is reflected in the left
    // pane's body without a manual reload.
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
          <Microscope className="size-3.5 text-emerald-400" />
          <span>Researcher</span>
          <span className="text-[10px] font-normal text-zinc-500">
            · per-project memory
          </span>
        </div>
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
        hint={isStreaming ? "Researcher is replying ↓" : "Jump to latest"}
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
            // Cmd/Ctrl+Enter submits — mirrors task & comment composers.
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask a question, refine, or hand off…"
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

/* ─── pieces ──────────────────────────────────────── */

function EmptyState() {
  const examples = [
    "What are our options for adding realtime presence to designs?",
    "How are we currently handling auth across the app?",
    "Compare Liveblocks, Y.js, and a custom WS for this team.",
  ];
  return (
    <div className="flex flex-col gap-3 pt-8 text-xs text-zinc-500">
      <p className="px-1 text-center text-zinc-400">
        Ask a fuzzy question. The researcher will pull from boards, tasks,
        designs — and the web — and write into the note.
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
          <Microscope className="size-3" />
          Researcher
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

/* ─── tool-result summaries (compact strings shown inline) ─ */

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
    case "list_project_designs":
      return data ? `Found ${data.designs?.length ?? 0} design(s)` : null;
    case "search_project_tasks":
      return data ? `Found ${data.tasks?.length ?? 0} task(s)` : null;
    case "list_recent_research_notes":
      return data ? `Found ${data.notes?.length ?? 0} prior note(s)` : null;
    case "read_board":
      return data ? `Read board · ${data.bytes} bytes` : null;
    case "update_research_note":
      return data ? `Wrote ${data.bytes} bytes into the note` : null;
    case "web_search":
      return data
        ? `Searched · ${data.results?.length ?? 0} result(s)`
        : null;
    default:
      return null;
  }
}

// Suppress unused-import — `FileText` is reserved for the next iteration's
// "open note" tool result. Drop if still unused after slice 2.
void FileText;
