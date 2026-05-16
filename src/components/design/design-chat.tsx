"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Layers, Paperclip, Sparkles, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/board/chat-markdown";

import {
  BoardMentionComposer,
  type BoardMentionComposerHandle,
} from "./board-mention-composer";
import type { BoardMentionItem } from "./board-mention-suggestion";
import { ChatError } from "@/components/chat/chat-error";
import { ScrollToBottomPill } from "@/components/chat/scroll-to-bottom-pill";
import {
  ToolPart,
  type ToolUIPartLike,
} from "@/components/chat/tool-part";
import { useChatAutoScroll } from "@/components/chat/use-chat-auto-scroll";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  executeAddArtboard,
  executeAddNodes,
  executeApplyTheme,
  executeDeleteArtboard,
  executeDeleteNodes,
  executeDuplicateArtboard,
  executeDuplicateNode,
  executeExtractComponent,
  executeFindNodes,
  executeGetArtboard,
  executeListAssets,
  executeListComponents,
  executeConnectArtboards,
  executeDisconnectArtboards,
  executeListFlows,
  executeListTokens,
  executeMoveNodes,
  executePatchNode,
  executePatchNodes,
  executeQueryCanvas,
  executeSaveAttachmentAsAsset,
  executeScreenshotArtboard,
  executeSetTokens,
  executeUpdateArtboard,
  executeUpdateComponent,
  type ChatFileLookup,
  type TokenReadContext,
  type TokenWriteContext,
} from "./canvas-tools";
import { useDesignCanvas } from "./canvas-store";
import { useComponentLibrary } from "./component-library-context";
import { findNodePathInTree, nodeLabel } from "./node-utils";
import { PinnedElementsBar } from "./pinned-elements-bar";
import { useTokens } from "./token-context";

export interface DesignChatProps {
  designId: string;
  initialMessages?: UIMessage[];
}

const TOOL_LABELS: Record<string, string> = {
  query_canvas: "Reading canvas",
  add_artboard: "Drawing artboard",
  update_artboard: "Updating artboard",
  delete_artboard: "Deleting artboard",
  duplicate_artboard: "Cloning artboard",
  get_artboard: "Reading artboard",
  find_nodes: "Searching artboard",
  patch_node: "Patching element",
  patch_nodes: "Patching elements",
  add_nodes: "Adding elements",
  delete_nodes: "Removing elements",
  move_nodes: "Moving elements",
  duplicate_node: "Duplicating element",
  screenshot_artboard: "Capturing screenshot",
  save_attachment_as_asset: "Saving attachment to library",
  apply_theme: "Applying theme",
  list_tokens: "Reading design tokens",
  set_tokens: "Writing design tokens",
  connect_artboards: "Wiring flow",
  disconnect_artboards: "Removing flow",
  list_flows: "Reading flows",
  extract_component: "Saving component",
  update_component: "Updating component",
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
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Mirror the editor's emptiness + mention count into React state
  // so the Send button can react to typing without forcing a re-render
  // tree on every keystroke (the editor itself is uncontrolled).
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [mentionCount, setMentionCount] = useState(0);
  const composerRef = useRef<BoardMentionComposerHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const library = useComponentLibrary();
  const tokens = useTokens();
  const router = useRouter();
  // Reactive view of pinned-element count so the Send button enables
  // when only pins are present (no text, no file attachments).
  const pinnedCount = useDesignCanvas((s) => s.selectedNodeIds.length);

  // Mirror `messages` into a ref so async tool dispatch can read the
  // latest stream snapshot without retriggering useChat on every
  // change. save_attachment_as_asset uses this to look up FileUIParts
  // by filename without the model having to echo their bytes.
  const messagesRef = useRef<UIMessage[]>(initialMessages ?? []);

  // Same trick for tokens — list_tokens and set_tokens fire from the
  // long-lived useChat closure, but the live tokens map can change
  // after the closure was captured (e.g. another tab updated team
  // tokens, or an earlier set_tokens call already pushed an
  // optimistic patch this turn). Writing the ref in an effect (not in
  // render) keeps react-hooks/refs happy.
  const tokensRef = useRef(tokens);

  const { messages, sendMessage, status, error, regenerate, addToolOutput, stop } =
    useChat({
      messages: initialMessages,
      transport: new DefaultChatTransport({
        api: `/api/design-chat/${designId}`,
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      async onToolCall({ toolCall }) {
        if (toolCall.dynamic) return;

        // Snapshot tokens / register-fns at dispatch time. tokensRef
        // tracks the freshest TokenContextValue (overlays included).
        const buildTokenReadContext = (): TokenReadContext => {
          const t = tokensRef.current;
          return { team: t.team, design: t.design, merged: t.merged };
        };
        const buildTokenWriteContext = (): TokenWriteContext => {
          const t = tokensRef.current;
          return {
            designId,
            registerOptimisticDesignTokens: t.registerOptimisticDesignTokens,
            registerOptimisticTeamTokens: t.registerOptimisticTeamTokens,
          };
        };

        // Helper: emit a tool result envelope. Tool-level errors come back
        // INSIDE the envelope (`{ ok: false, error }`) — only catastrophic
        // failures (unknown tool, executor exception) use `output-error`.
        const emit = (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          output: any,
        ) =>
          addToolOutput({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool: toolCall.toolName as any,
            toolCallId: toolCall.toolCallId,
            output,
          });

        const fatal = (errorText: string) =>
          addToolOutput({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool: toolCall.toolName as any,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText,
          });

        try {
          switch (toolCall.toolName) {
            case "query_canvas":
              emit(executeQueryCanvas());
              break;
            case "add_artboard":
              emit(
                executeAddArtboard(
                  toolCall.input as Parameters<typeof executeAddArtboard>[0],
                ),
              );
              break;
            case "update_artboard":
              emit(
                executeUpdateArtboard(
                  toolCall.input as Parameters<typeof executeUpdateArtboard>[0],
                ),
              );
              break;
            case "delete_artboard":
              emit(
                executeDeleteArtboard(
                  toolCall.input as Parameters<typeof executeDeleteArtboard>[0],
                ),
              );
              break;
            case "get_artboard":
              emit(
                executeGetArtboard(
                  toolCall.input as Parameters<typeof executeGetArtboard>[0],
                ),
              );
              break;
            case "find_nodes":
              emit(
                executeFindNodes(
                  toolCall.input as Parameters<typeof executeFindNodes>[0],
                ),
              );
              break;
            case "patch_node":
              emit(
                executePatchNode(
                  toolCall.input as Parameters<typeof executePatchNode>[0],
                ),
              );
              break;
            case "duplicate_node":
              emit(
                executeDuplicateNode(
                  toolCall.input as Parameters<typeof executeDuplicateNode>[0],
                ),
              );
              break;
            case "duplicate_artboard":
              emit(
                executeDuplicateArtboard(
                  toolCall.input as Parameters<typeof executeDuplicateArtboard>[0],
                ),
              );
              break;
            case "screenshot_artboard":
              emit(
                await executeScreenshotArtboard(
                  toolCall.input as Parameters<typeof executeScreenshotArtboard>[0],
                ),
              );
              break;
            case "save_attachment_as_asset": {
              // Snapshot every FileUIPart visible in the conversation
              // so the executor can resolve `filename` → bytes without
              // the model having to echo a multi-megabyte data URL.
              const chatFiles = collectChatFiles(messagesRef.current);
              const output = await executeSaveAttachmentAsAsset(
                toolCall.input as Parameters<
                  typeof executeSaveAttachmentAsAsset
                >[0],
                chatFiles,
              );
              emit(output);
              if (output.ok) {
                // Optimistic library push — the agent and any image
                // node referencing the new url see the asset
                // immediately, before router.refresh() round-trips.
                library.registerOptimisticAsset({
                  id: output.data.id,
                  name: output.data.name,
                  url: output.data.url,
                  mimeType: output.data.mimeType,
                  size: output.data.size,
                });
                router.refresh();
              }
              break;
            }
            case "add_nodes":
              emit(
                executeAddNodes(
                  toolCall.input as Parameters<typeof executeAddNodes>[0],
                ),
              );
              break;
            case "delete_nodes":
              emit(
                executeDeleteNodes(
                  toolCall.input as Parameters<typeof executeDeleteNodes>[0],
                ),
              );
              break;
            case "move_nodes":
              emit(
                executeMoveNodes(
                  toolCall.input as Parameters<typeof executeMoveNodes>[0],
                ),
              );
              break;
            case "patch_nodes":
              emit(
                executePatchNodes(
                  toolCall.input as Parameters<typeof executePatchNodes>[0],
                ),
              );
              break;
            case "apply_theme": {
              const output = await executeApplyTheme(
                toolCall.input as Parameters<typeof executeApplyTheme>[0],
                buildTokenWriteContext(),
              );
              emit(output);
              if (output.ok) router.refresh();
              break;
            }
            case "list_tokens":
              emit(executeListTokens(buildTokenReadContext()));
              break;
            case "set_tokens": {
              const output = await executeSetTokens(
                toolCall.input as Parameters<typeof executeSetTokens>[0],
                buildTokenWriteContext(),
              );
              emit(output);
              if (output.ok) router.refresh();
              break;
            }
            case "extract_component": {
              const output = await executeExtractComponent(
                toolCall.input as Parameters<typeof executeExtractComponent>[0],
                // Optimistic library push — without this, every artboard
                // with the new component-ref shows a missing-component
                // placeholder until router.refresh() round-trips.
                { onComponentSaved: library.registerOptimisticComponent },
              );
              emit(output);
              // router.refresh() is still kicked so the next server-side
              // listDesignComponentsForTeam pickup matches the optimistic
              // entry; the overlay drops out automatically when the
              // server-provided list catches up.
              if (output.ok) router.refresh();
              break;
            }
            case "update_component": {
              const output = await executeUpdateComponent(
                toolCall.input as Parameters<typeof executeUpdateComponent>[0],
                library.components,
                { onComponentSaved: library.registerOptimisticComponent },
              );
              emit(output);
              // The optimistic push already drove the in-canvas re-render;
              // refresh aligns the server-provided list (and any other
              // open tabs) with what we already showed.
              if (output.ok) router.refresh();
              break;
            }
            case "list_components":
              emit(executeListComponents(library.components));
              break;
            case "list_assets":
              emit(executeListAssets(library.assets));
              break;
            case "connect_artboards":
              emit(
                executeConnectArtboards(
                  toolCall.input as Parameters<typeof executeConnectArtboards>[0],
                ),
              );
              break;
            case "disconnect_artboards":
              emit(
                executeDisconnectArtboards(
                  toolCall.input as Parameters<typeof executeDisconnectArtboards>[0],
                ),
              );
              break;
            case "list_flows":
              emit(executeListFlows());
              break;
            default:
              fatal(`Unknown tool: ${toolCall.toolName}`);
          }
        } catch (err) {
          fatal(err instanceof Error ? err.message : "Tool failed");
        }
      },
    });

  const isStreaming = status === "streaming" || status === "submitted";

  // Keep messagesRef in sync with the live `messages` array so the
  // async tool-dispatch closure (defined once when useChat mounts)
  // always reads the latest snapshot. Without this, save_attachment_
  // as_asset would never see freshly attached files.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Same for tokens — see tokensRef declaration above.
  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  // Smart auto-scroll: pin to bottom only while the user is already there
  // so they can scroll up to read history without being yanked back.
  const { containerRef, isAtBottom, onScroll, scrollToBottom } =
    useChatAutoScroll([messages, isStreaming]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // Search callback for the @-mention suggestion popover.
  // Pulled out as a stable identity so the editor (which captures it
  // once) doesn't tear itself down on every render.
  const searchBoards = useCallback(
    async (query: string): Promise<BoardMentionItem[]> => {
      try {
        // Hits the unified search endpoint that returns boards,
        // research notes, and plans together — the popover groups
        // them by kind. We pass `designId` so the design's project
        // floats to the top across all three kinds.
        const url = new URL(
          "/api/mentions/search",
          window.location.origin,
        );
        if (query) url.searchParams.set("q", query);
        url.searchParams.set("designId", designId);
        const res = await fetch(url.toString(), { credentials: "same-origin" });
        if (!res.ok) return [];
        const json = (await res.json()) as { items?: BoardMentionItem[] };
        if (json.items) return json.items;
        // Back-compat fallback for any cached deploy still serving
        // the old `/boards`-shaped response.
        const legacy = json as unknown as { boards?: BoardMentionItem[] };
        return legacy.boards ?? [];
      } catch {
        return [];
      }
    },
    [designId],
  );

  const composerSnapshot = useMemo(
    () => ({
      onChange: ({
        isEmpty,
        mentionCount,
      }: {
        isEmpty: boolean;
        mentionCount: number;
      }) => {
        setComposerEmpty(isEmpty);
        setMentionCount(mentionCount);
      },
    }),
    [],
  );

  const submit = async () => {
    if (isStreaming) return;
    const composer = composerRef.current;
    const text = composer?.getText() ?? "";
    // Pull all mentions bucketed by kind. The chat API route accepts
    // the bucketed shape and builds digests per kind. We still
    // compute the legacy flat board-id list for the empty-message
    // guard below — sending a message with only mentions is OK.
    const mentions =
      composer?.getMentionedIdsByKind() ?? {
        boards: [],
        research: [],
        plans: [],
      };
    const totalMentions =
      mentions.boards.length +
      mentions.research.length +
      mentions.plans.length;
    // Pinned elements alone are enough to send — the chips ARE the
    // user's intent ("look at this and tell me what to do with it").
    const pinnedIds = useDesignCanvas.getState().selectedNodeIds;
    if (
      !text &&
      pending.length === 0 &&
      pinnedIds.length === 0 &&
      totalMentions === 0
    ) {
      return;
    }

    // Build the pinned-elements payload BEFORE clearing state so a
    // mid-flight cancellation doesn't lose the picks. Each pinned id
    // becomes (a) one entry in the JSON header so the agent learns
    // the artboardId/nodeId/type/label/parentChain, and (b) one
    // FileUIPart with a per-node PNG so the agent can SEE it.
    const pinnedPayload =
      pinnedIds.length > 0 ? await buildPinnedPayload(pinnedIds) : null;

    // Convert each user-attached File to a data-URL FileUIPart so
    // the AI SDK can pass it through to the model without uploading
    // to storage first. (Persistent assets go through
    // `save_attachment_as_asset`.)
    const userFiles =
      pending.length === 0
        ? []
        : await Promise.all(
            pending.map(async (p) => ({
              type: "file" as const,
              filename: p.file.name,
              mediaType: p.file.type,
              url: await fileToDataUrl(p.file),
            })),
          );

    // Order in the message context matters: pinned-elements header
    // first (so the model sees "this is what they're talking about"
    // before reading the prompt), then per-node screenshots, then any
    // user-attached files, then the user's free text.
    const headerText = pinnedPayload
      ? `[pinned-elements] ${JSON.stringify(pinnedPayload.header)}`
      : null;
    const finalText = headerText
      ? text
        ? `${headerText}\n\n${text}`
        : headerText
      : // Fallback prompt only when ALL three payload slots are empty
        // is impossible by the guard above, so we always have either
        // text, files, or pinnedPayload here.
        text || "What do you see in this image?";

    const files = [
      ...(pinnedPayload?.files ?? []),
      ...userFiles,
    ];

    sendMessage(
      {
        text: finalText,
        files: files.length > 0 ? files : undefined,
      },
      // The /api/design-chat/[designId] route reads `mentions` off
      // the request body — a `{boards, research, plans}` bucketed
      // shape — looks up each entity for the active team, builds a
      // per-kind digest (board snapshots, research-note bodies,
      // plan rows), and prepends the concatenated blob to the user
      // message before forwarding to the agent. None of that is
      // visible to the user; the persisted text gets stripped
      // client-side and replaced with chips (see
      // `renderUserMessageText`).
      //
      // We also pass `mentionedBoardIds` for one release as a
      // back-compat shim — if a stale frame (e.g. a service worker
      // cache) is still POSTing the old shape, the server can
      // continue accepting it without breaking sends.
      totalMentions > 0
        ? {
            body: {
              mentions,
              mentionedBoardIds: mentions.boards,
            },
          }
        : undefined,
    );

    composer?.clear();
    setComposerEmpty(true);
    setMentionCount(0);
    // Clear pending attachments and revoke their object URLs so they get GC'd.
    for (const p of pending) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
    setAttachError(null);
    // Clear pinned elements after send — they were context for THIS
    // message, not a sticky preference.
    if (pinnedIds.length > 0) {
      useDesignCanvas.getState().clearNodeSelection();
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
            <ChatError
              error={error}
              onRetry={() => {
                void regenerate();
              }}
              isRetrying={isStreaming}
            />
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
        {/* Picked-element chips. Renders nothing when nothing is
            pinned, so the composer doesn't grow vertically in the
            common case. */}
        <PinnedElementsBar />

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
          <BoardMentionComposer
            ref={composerRef}
            placeholder="Describe what to design…"
            onChange={composerSnapshot.onChange}
            onSubmit={() => void submit()}
            onPasteFiles={(files) => addFiles(files)}
            searchBoards={searchBoards}
            className="flex-1"
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
              disabled={
                composerEmpty &&
                pending.length === 0 &&
                pinnedCount === 0 &&
                mentionCount === 0
              }
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
            // User messages may carry server-injected
            // `[mentioned-board: …][/mentioned-board]` digest blocks
            // (see /api/design-chat/[designId]/route.ts). Strip them
            // out for the rendered bubble and surface as compact
            // chips above the text instead — the digest is for the
            // agent, not the human.
            if (isUser) {
              const stripped = stripMentionDigests(part.text);
              return (
                <div key={index} className="flex flex-col gap-1.5">
                  {stripped.boardNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {stripped.boardNames.map((name, i) => (
                        <span
                          key={`${name}-${i}`}
                          className="inline-flex items-center gap-1 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700"
                          title={`Mentioned board: ${name}`}
                        >
                          <Layers className="size-3" />
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {stripped.text ? (
                    <ChatMarkdown className="text-zinc-900">
                      {stripped.text}
                    </ChatMarkdown>
                  ) : null}
                </div>
              );
            }
            return (
              <ChatMarkdown key={index} className="text-zinc-100">
                {part.text}
              </ChatMarkdown>
            );
          }
          if (part.type === "file") {
            return <FilePart key={index} part={part} />;
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

/* ─── helpers ──────────────────────────────────────── */

/**
 * Pull every `[mentioned-board: <name>] … [/mentioned-board]` block
 * (and the trailing `[mentioned-boards-truncated]` notice if any) out
 * of a user message's persisted text, returning the cleaned-up
 * remainder along with the list of board names. The agent gets the
 * full digest because the original text is what's persisted in the
 * memory thread; the human only ever sees compact chips here.
 */
function stripMentionDigests(text: string): {
  text: string;
  boardNames: string[];
} {
  const boardNames: string[] = [];
  // [mentioned-board: NAME]\n(meta)\n\n<sections>\n\n[/mentioned-board]
  // The non-greedy body match plus a trailing `\n*` mops up the
  // leading newline the server inserts before the user's text.
  const blockRe =
    /\[mentioned-board:\s*([^\]\n]+)\][\s\S]*?\[\/mentioned-board\]\n*/g;
  const cleaned = text
    .replace(blockRe, (_match, name: string) => {
      boardNames.push(name.trim());
      return "";
    })
    // Drop the truncation marker line if the server emitted one.
    .replace(/\[mentioned-boards-truncated\][^\n]*\n*/g, "")
    // Old `[pinned-elements] {…}` headers are also persisted but the
    // existing chat renders them verbatim today; leave that to a
    // separate pass so this change only touches mention rendering.
    .trim();
  return { text: cleaned, boardNames };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Per-pinned-element payload: a concise JSON header describing each
 * pinned node + a per-node PNG screenshot. The header lets the agent
 * resolve "what to patch" directly (it has the artboardId + nodeId);
 * the screenshot lets it SEE what the user pinned.
 *
 * Each PNG is captured at scale=1 first; if it busts the 1.5 MB cap
 * we retry at progressively smaller scales. Mirrors the screenshot
 * tool's anti-blowup approach. The cap is tighter than
 * `screenshot_artboard`'s 2 MB because we send N elements and don't
 * want a single bloated chip to crowd out the rest of the message.
 */
async function buildPinnedPayload(nodeIds: readonly string[]): Promise<{
  header: { items: PinnedItemHeader[] };
  files: Array<{
    type: "file";
    filename: string;
    mediaType: string;
    url: string;
  }>;
} | null> {
  const state = useDesignCanvas.getState();
  // Lazy-load html-to-image — same pattern as screenshot_artboard.
  // Skipped entirely when nothing is pinned, so the chat page never
  // pays for it just by mounting.
  const { toPng } = await import("html-to-image");

  const items: PinnedItemHeader[] = [];
  const files: Array<{
    type: "file";
    filename: string;
    mediaType: string;
    url: string;
  }> = [];

  for (const nodeId of nodeIds) {
    // Locate the node + its artboard + its parent chain in one pass.
    let artboardId: string | null = null;
    let artboardName: string | null = null;
    let path: ReturnType<typeof findNodePathInTree> = null;
    for (const ab of state.artboards) {
      if (!ab.design) continue;
      const found = findNodePathInTree(ab.design, nodeId);
      if (found) {
        path = found;
        artboardId = ab.id;
        artboardName = ab.name;
        break;
      }
    }
    if (!path || !artboardId || !artboardName) continue;

    const parentChain = path.parentChain
      .map((n) => nodeLabel(n, 24))
      .filter((s) => s && s !== "div"); // skip generic wrappers
    const label = nodeLabel(path.node, 64);

    // Snap the rendered DOM. We've already established the node has
    // an id (it's how we found it); query by that id, scoped to the
    // owning artboard's frame so we don't grab a duplicate from
    // another artboard with the same id.
    const dom = document.querySelector<HTMLElement>(
      `[data-artboard-frame-id="${artboardId}"] [data-node-id="${nodeId}"]`,
    );
    let dataUrl: string | null = null;
    if (dom) {
      for (const scale of [1, 0.75, 0.5, 0.35] as const) {
        try {
          const png = await toPng(dom, {
            pixelRatio: scale,
            cacheBust: true,
            skipFonts: true,
          });
          if (estimateDataUrlBytes(png) <= 1.5 * 1024 * 1024) {
            dataUrl = png;
            break;
          }
        } catch {
          // ignore — fall through to the next scale or to no PNG
        }
      }
    }

    items.push({
      artboardId,
      artboardName,
      nodeId,
      type: path.node.type,
      label,
      parentChain,
      hasScreenshot: dataUrl !== null,
    });

    if (dataUrl) {
      files.push({
        type: "file",
        // Filename encodes the id so the agent can correlate
        // (path.node.type) + the JSON header without ambiguity.
        filename: `pinned-${nodeId}.png`,
        mediaType: "image/png",
        url: dataUrl,
      });
    }
  }

  if (items.length === 0) return null;
  return { header: { items }, files };
}

interface PinnedItemHeader {
  artboardId: string;
  artboardName: string;
  nodeId: string;
  type: string;
  label: string;
  parentChain: string[];
  hasScreenshot: boolean;
}

/** Same approximation used by executeScreenshotArtboard. */
function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Walk every UIMessage and pull out FileUIParts as a flat
 * `ChatFileLookup[]` for the save_attachment_as_asset executor. Only
 * parts with a `filename` and a `url` are kept (anonymous file parts
 * are unreachable by the agent's filename-based lookup anyway).
 */
function collectChatFiles(messages: UIMessage[]): ChatFileLookup[] {
  const result: ChatFileLookup[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      // FileUIPart shape: { type: "file", url, mediaType?, filename? }.
      // Cast is local — the AI SDK types this as a discriminated
      // union but we only need a few fields.
      const filePart = part as FileUIPartLike;
      if (!filePart.filename || !filePart.url) continue;
      result.push({
        filename: filePart.filename,
        mediaType: filePart.mediaType,
        url: filePart.url,
      });
    }
  }
  return result;
}

function describeToolResult(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
): string | null {
  // Surface tool-level errors compactly in the chat sidebar.
  if (output && output.ok === false && output.error) {
    return `Failed · ${output.error.code}: ${output.error.message}`;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = output && output.ok === true ? output.data : null;

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
    case "duplicate_artboard":
      return "Cloned artboard";
    case "get_artboard":
      return "Read artboard";
    case "find_nodes":
      if (data) {
        return `Found ${data.totalMatched} match${
          data.totalMatched === 1 ? "" : "es"
        }`;
      }
      return "Searched artboard";
    case "patch_node": {
      const fields = input?.patch ? describePatchFields(input.patch) : null;
      return fields ? `Patched element · ${fields}` : "Patched element";
    }
    case "patch_nodes": {
      const count = data?.patchedNodeIds?.length;
      const fields = input?.patch ? describePatchFields(input.patch) : null;
      if (typeof count === "number") {
        const head = `Patched ${count} element${count === 1 ? "" : "s"}`;
        return fields ? `${head} · ${fields}` : head;
      }
      return fields ? `Patched elements · ${fields}` : "Patched elements";
    }
    case "add_nodes": {
      const count =
        data?.insertedNodeIds?.length ??
        (Array.isArray(input?.nodes) ? input.nodes.length : null);
      if (count !== null) {
        return `Added ${count} element${count === 1 ? "" : "s"}`;
      }
      return "Added elements";
    }
    case "delete_nodes": {
      const count = data?.deletedNodeIds?.length;
      if (typeof count === "number") {
        return `Removed ${count} element${count === 1 ? "" : "s"}`;
      }
      return "Removed elements";
    }
    case "move_nodes": {
      const count = data?.movedNodeIds?.length;
      if (typeof count === "number") {
        return `Moved ${count} element${count === 1 ? "" : "s"}`;
      }
      return "Moved elements";
    }
    case "duplicate_node":
      return "Duplicated element";
    case "screenshot_artboard": {
      if (data?.width && data?.height) {
        const scale = data.scale ?? 1;
        const scaleNote = scale < 1 ? ` · ${scale}×` : "";
        return `Captured ${data.width}×${data.height}${scaleNote}`;
      }
      return "Captured screenshot";
    }
    case "save_attachment_as_asset":
      return data?.name
        ? `Saved "${data.name}" to library`
        : "Saved attachment to library";
    case "apply_theme": {
      const tokens: string[] = data?.tokensWritten ?? [];
      if (tokens.length > 0) {
        // Strip the namespace prefix so the sidebar shows the leaf
        // ("accent" instead of "color.accent") — tighter on a 380-px
        // panel.
        const leaves = tokens.map((t) => t.split(".").slice(-1)[0]);
        return `Themed · ${leaves.join(", ")}`;
      }
      return "Applied theme";
    }
    case "list_tokens": {
      const designCount = data?.design ? Object.keys(data.design).length : 0;
      const teamCount = data?.team ? Object.keys(data.team).length : 0;
      return `Read tokens · ${designCount} design / ${teamCount} team`;
    }
    case "set_tokens": {
      const written: string[] = data?.writtenKeys ?? [];
      const cleared: string[] = data?.clearedKeys ?? [];
      const scope = data?.scope ?? input?.scope ?? "design";
      const parts: string[] = [];
      if (written.length > 0) {
        parts.push(`set ${written.length}`);
      }
      if (cleared.length > 0) {
        parts.push(`cleared ${cleared.length}`);
      }
      const summary = parts.length > 0 ? parts.join(", ") : "no-op";
      return `Tokens (${scope}) · ${summary}`;
    }
    case "extract_component":
      return data?.componentSlug
        ? `Saved component "${data.componentSlug}"`
        : "Saved component";
    case "update_component":
      return data?.componentSlug
        ? `Updated component "${data.componentSlug}"`
        : "Updated component";
    case "list_components":
      return "Read component library";
    case "list_assets":
      return "Read uploaded assets";
    case "connect_artboards":
      return data
        ? `Wired flow → ${truncateId(data.toArtboardId)}`
        : "Wired flow";
    case "disconnect_artboards":
      return "Removed flow";
    case "list_flows": {
      const count = data?.flows?.length ?? 0;
      return `Read flows · ${count}`;
    }
    default:
      return null;
  }
}

/** Truncate a long id for compact sidebar display. */
function truncateId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describePatchFields(patch: any): string | null {
  if (!patch || typeof patch !== "object") return null;
  const parts: string[] = [];
  if (patch.style && typeof patch.style === "object") {
    const keys = Object.keys(patch.style);
    if (keys.length > 0) {
      parts.push(keys.length === 1 ? keys[0] : `${keys.length} style props`);
    }
  }
  for (const k of ["text", "label", "src", "alt", "href", "placeholder", "title"]) {
    if (typeof patch[k] === "string") parts.push(k);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
