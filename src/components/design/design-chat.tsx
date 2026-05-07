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
  Paperclip,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/board/chat-markdown";
import { ScrollToBottomPill } from "@/components/chat/scroll-to-bottom-pill";
import { useChatAutoScroll } from "@/components/chat/use-chat-auto-scroll";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  executeAddArtboard,
  executeDeleteArtboard,
  executeGetArtboard,
  executeListAssets,
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
  list_assets: "Reading uploaded assets",
};

/**
 * Chat panel for the design agent (right side of the design canvas).
 *
 * Mirrors the board chat in shape — same composer, same scroll, same
 * markdown — but points at /api/design-chat/[designId] and dispatches
 * the design canvas tools (add_artboard / update_artboard / etc.) into
 * the zustand store via `onToolCall`.
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per image
const MAX_FILES = 5;

interface PendingFile {
  /** Stable id so we can remove a single attachment. */
  id: string;
  file: File;
  /** Object URL used to preview the image in the composer thumbnail. */
  previewUrl: string;
}

export function DesignChat({ designId, initialMessages }: DesignChatProps) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
              const output = executeListComponents(library.components);
              addToolOutput({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tool: toolCall.toolName as any,
                toolCallId: toolCall.toolCallId,
                output,
              });
              break;
            }
            case "list_assets": {
              const output = executeListAssets(library.assets);
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

  // Smart auto-scroll: pin to bottom only while the user is already there
  // so they can scroll up to read history without being yanked back.
  const { containerRef, isAtBottom, onScroll, scrollToBottom } =
    useChatAutoScroll([messages, isStreaming]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  const submit = async () => {
    const text = input.trim();
    if (isStreaming) return;
    if (!text && pending.length === 0) return;

    // Convert each File to a data-URL FileUIPart so the AI SDK can pass
    // it through to the model without the chat needing to upload to
    // storage first. Persistent asset uploads land in the next commit.
    const files =
      pending.length === 0
        ? undefined
        : await Promise.all(
            pending.map(async (p) => ({
              type: "file" as const,
              filename: p.file.name,
              mediaType: p.file.type,
              url: await fileToDataUrl(p.file),
            })),
          );

    sendMessage({
      text: text || "What do you see in this image?",
      files,
    });

    setInput("");
    // Clear pending attachments and revoke their object URLs so they get GC'd.
    for (const p of pending) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
    setAttachError(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const addFiles = (files: FileList | File[]) => {
    setAttachError(null);
    const incoming = Array.from(files);
    const next: PendingFile[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        setAttachError("Only image files are supported.");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setAttachError(`Image too large: ${file.name} (max 5 MB).`);
        continue;
      }
      if (pending.length + next.length >= MAX_FILES) {
        setAttachError(`Up to ${MAX_FILES} images per message.`);
        break;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length > 0) setPending((prev) => [...prev, ...next]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLFormElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
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
          void submit();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="flex flex-col gap-2 border-t border-white/5 p-3"
      >
        {pending.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="group relative size-16 overflow-hidden rounded-md border border-white/10 bg-zinc-900"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={p.file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {attachError ? (
          <p className="text-[11px] text-red-300">{attachError}</p>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = ""; // allow picking the same file again
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach image"
            title="Attach image (or paste / drop into the chat)"
          >
            <Paperclip className="size-4" />
          </Button>
          <Textarea
            ref={composerRef}
            rows={1}
            placeholder="Describe what to design…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
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
              disabled={!input.trim() && pending.length === 0}
              aria-label="Send message"
              title="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
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
        // Hairline separator between consecutive agent messages so big
        // multi-message exchanges stay readable. Skip the rule on the
        // last item to keep the bottom of the list clean.
        !isUser && !isLast && "border-b border-white/5 pb-4",
      )}
    >
      {!isUser ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <Sparkles className="size-3" />
          Designer
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
          if (part.type === "file") {
            return <FilePart key={index} part={part} />;
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

interface FileUIPartLike {
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
}

function FilePart({ part }: { part: FileUIPartLike }) {
  if (part.mediaType && part.mediaType.startsWith("image/")) {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-fit overflow-hidden rounded-md border border-white/10"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={part.url}
          alt={part.filename ?? "attachment"}
          className="max-h-72 max-w-full object-contain"
        />
      </a>
    );
  }
  return (
    <a
      href={part.url}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200"
    >
      {part.filename ?? "Attachment"}
    </a>
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

/* ─── helpers ──────────────────────────────────────── */

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
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
    case "list_assets":
      return "Read uploaded assets";
    default:
      return null;
  }
}
