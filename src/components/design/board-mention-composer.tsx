"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

import {
  createBoardMentionExtension,
  type BoardMentionConfig,
} from "./board-mention-extension";
import type { MentionKind } from "./board-mention-suggestion";

/**
 * Per-kind id buckets. Returned from
 * {@link BoardMentionComposerHandle.getMentionedIdsByKind} so the
 * design-chat client can ship `{boards, research, plans}` to its
 * API route in a single request body.
 *
 * Order within each array preserves the order the user mentioned
 * them — relevant when the agent reads the digest blocks (the
 * digests are concatenated in the same order so the user's intent
 * "look at A first, then B" survives).
 */
export interface MentionedIdsByKind {
  boards: string[];
  research: string[];
  plans: string[];
}

/**
 * Imperative handle the parent (e.g. `design-chat.tsx`) calls into.
 *
 *  - `focus()` — pull focus into the editor on mount, after a paste,
 *    or after a `clear()`.
 *  - `clear()` — wipe the doc back to empty after a successful send.
 *  - `getText()` — plain text the user typed (mentions render as
 *    `@<label>` per `renderText` in the extension).
 *  - `getMentionedIdsByKind()` — flat, dedup'd, kind-bucketed list
 *    of `data-id`s pulled out of every `mention` node currently in
 *    the doc.
 *  - `getMentionedBoardIds()` — back-compat shim; equivalent to
 *    `getMentionedIdsByKind().boards`. Kept so consumers that only
 *    care about boards can stay compact.
 */
export interface BoardMentionComposerHandle {
  focus: () => void;
  clear: () => void;
  getText: () => string;
  getMentionedIdsByKind: () => MentionedIdsByKind;
  getMentionedBoardIds: () => string[];
  isEmpty: () => boolean;
}

export interface BoardMentionComposerProps {
  placeholder?: string;
  /** Live count callback so the Send button can react to typing. */
  onChange?: (snapshot: { isEmpty: boolean; mentionCount: number }) => void;
  /** Raised on Enter (without Shift). The parent decides whether to send. */
  onSubmit?: () => void;
  /** Pasted files (images) are forwarded to the parent for the attachments rail. */
  onPasteFiles?: (files: File[]) => void;
  /** Per-message dedupe + cap state for the suggestion popover. */
  searchBoards: BoardMentionConfig["searchBoards"];
  className?: string;
}

const MAX_MENTIONS = 3;

/**
 * Tiptap-based composer with `@`-mention support across boards,
 * research notes, and plans (a single popover, grouped sections).
 *
 * The editor is intentionally minimal: paragraphs only (no headings,
 * lists, blockquotes, code blocks). It feels like a textarea but
 * renders mention chips and supports Enter-to-submit / Shift-Enter
 * for newline.
 *
 * Historical name: "BoardMentionComposer". Kept for API stability —
 * the new generalized behaviour is backwards-compatible at the call
 * site.
 */
export const BoardMentionComposer = forwardRef<
  BoardMentionComposerHandle,
  BoardMentionComposerProps
>(function BoardMentionComposer(
  {
    placeholder,
    onChange,
    onSubmit,
    onPasteFiles,
    searchBoards,
    className,
  },
  ref,
) {
  // Latest mentioned-id snapshot, kept in a ref so the suggestion
  // popover's `getSelectedIds` callback always reads fresh data
  // without re-running its closure on every doc change.
  const selectedIdsRef = useRef<string[]>([]);

  // Stable callbacks for the Mention extension factory. Building
  // the extension once and feeding it accessor refs is cheaper than
  // tearing the editor down each time the selection changes.
  const mentionConfig = useMemo<BoardMentionConfig>(
    () => ({
      searchBoards,
      getSelectedIds: () => selectedIdsRef.current,
      getCapReached: () => selectedIdsRef.current.length >= MAX_MENTIONS,
    }),
    [searchBoards],
  );

  const mentionExtension = useMemo(
    () => createBoardMentionExtension(mentionConfig),
    [mentionConfig],
  );

  // Stable refs for callbacks the editor closes over once.
  const onSubmitRef = useRef(onSubmit);
  const onPasteFilesRef = useRef(onPasteFiles);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onPasteFilesRef.current = onPasteFiles;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Describe what to design…",
        showOnlyWhenEditable: true,
      }),
      mentionExtension,
    ],
    editorProps: {
      attributes: {
        class: cn(
          "prose-tiptap chat-composer min-h-9 max-h-40 w-full resize-none overflow-y-auto",
          "bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none",
          "rounded-md border border-input",
        ),
      },
      handleKeyDown(_view, event) {
        if (event.key === "Enter" && !event.shiftKey) {
          if (isSuggestionOpen()) return false;
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const files = readImageFilesFromClipboard(event.clipboardData);
        if (files.length > 0) {
          event.preventDefault();
          onPasteFilesRef.current?.(files);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      const buckets = collectMentionsByKind(editor.getJSON());
      // Flat selected list drives the popover dedupe; kind-bucketed
      // list is exposed via the imperative handle below.
      selectedIdsRef.current = [
        ...buckets.boards,
        ...buckets.research,
        ...buckets.plans,
      ];
      onChange?.({
        isEmpty: editor.isEmpty,
        mentionCount: selectedIdsRef.current.length,
      });
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      clear: () => {
        editor?.commands.clearContent();
        selectedIdsRef.current = [];
      },
      getText: () => (editor ? editor.getText().trim() : ""),
      getMentionedIdsByKind: () =>
        editor
          ? collectMentionsByKind(editor.getJSON())
          : { boards: [], research: [], plans: [] },
      getMentionedBoardIds: () =>
        editor ? collectMentionsByKind(editor.getJSON()).boards : [],
      isEmpty: () => (editor ? editor.isEmpty : true),
    }),
    [editor],
  );

  // Keep parent in sync on initial mount as well so the Send button
  // starts in the right disabled state.
  useEffect(() => {
    if (!editor) return;
    onChange?.({ isEmpty: editor.isEmpty, mentionCount: 0 });
  }, [editor, onChange]);

  return (
    <EditorContent editor={editor} className={cn("w-full", className)} />
  );
});

/* ─── Helpers ──────────────────────────────────────────── */

/**
 * Walk a Tiptap JSON document and collect every `mention` node's
 * `id` attr, bucketed by `kind`. Used for both the per-message
 * payload and the already-mentioned dimming inside the suggestion
 * popover.
 *
 * Ids are dedup'd within each bucket; insertion order (= order the
 * user typed them) is preserved.
 */
function collectMentionsByKind(doc: unknown): MentionedIdsByKind {
  const buckets: Record<MentionKind, string[]> = {
    board: [],
    research: [],
    plan: [],
  };
  const seen: Record<MentionKind, Set<string>> = {
    board: new Set(),
    research: new Set(),
    plan: new Set(),
  };
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as {
      type?: string;
      attrs?: { id?: unknown; kind?: unknown };
      content?: unknown[];
    };
    if (obj.type === "mention" && typeof obj.attrs?.id === "string") {
      const kind = normalizeKind(obj.attrs.kind);
      if (!seen[kind].has(obj.attrs.id)) {
        seen[kind].add(obj.attrs.id);
        buckets[kind].push(obj.attrs.id);
      }
    }
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) visit(child);
    }
  }
  visit(doc);
  return {
    boards: buckets.board,
    research: buckets.research,
    plans: buckets.plan,
  };
}

function normalizeKind(value: unknown): MentionKind {
  if (value === "research" || value === "plan") return value;
  return "board";
}

/**
 * Detect whether the suggestion plugin is currently rendering its
 * popover. Tiptap's Mention extension marks the decoration node
 * with `data-mention-suggestion-char` — testing for it in the live
 * DOM is cheaper than wiring a piece of React state through.
 */
function isSuggestionOpen(): boolean {
  return !!document.querySelector(
    "[data-mention-suggestion-char].is-empty, [data-mention-suggestion-char]:not(.is-empty)",
  );
}

function readImageFilesFromClipboard(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of data.items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file && file.type.startsWith("image/")) out.push(file);
    }
  }
  return out;
}
