"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatProps {
  boardId: string;
  initialMessages?: UIMessage[];
}

export function Chat({ boardId, initialMessages }: ChatProps) {
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `/api/chat/${boardId}`,
    }),
  });

  // Keep the composer focused on mount so users can just start typing.
  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // Scroll to bottom when a new message lands or while streaming.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
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
    <section className="flex h-full w-96 shrink-0 flex-col border-l border-white/5 bg-zinc-950/40 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Chat
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-zinc-600">
          {status === "streaming" ? "thinking…" : "ready"}
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 px-3 py-3">
          {messages.length === 0 ? (
            <p className="px-1 py-12 text-center text-xs text-zinc-500">
              Ask the agent to explain a system, draft a description, or
              outline an architecture.
            </p>
          ) : (
            messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))
          )}
          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
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
          placeholder="Ask the agent…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-40 min-h-9 resize-none bg-zinc-900/80 text-sm"
        />
        <Button
          type="submit"
          size="icon"
          disabled={
            !input.trim() || status === "streaming" || status === "submitted"
          }
          aria-label="Send message"
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </section>
  );
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Array<
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown }
  >;
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-zinc-100 text-zinc-900"
            : "bg-white/5 text-zinc-100",
        )}
      >
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <div
                key={index}
                className={cn(
                  "prose prose-sm max-w-none",
                  isUser
                    ? "prose-invert-off"
                    : "prose-invert",
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {(part as { text: string }).text}
                </ReactMarkdown>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
