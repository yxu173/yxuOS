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

/**
 * Imperative handle the parent (`design-chat.tsx`) calls into:
 *
 *  - `focus()` — pull focus into the editor on mount, after a paste,
 *    or after a `clear()`.
 *  - `clear()` — wipe the doc back to empty after a successful send.
 *  - `getText()` — plain text the user typed (mentions render as
 *    `@<label>` per `renderText` in the extension).
 *  - `getMentionedBoardIds()` — flat, dedup'd list of `data-id`s
 *    pulled out of every `mention` node currently in the doc.
 */
export interface BoardMentionComposerHandle {
  focus: () => void;
  clear: () => void;
  getText: () => string;
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
 * Tiptap-based composer for the design chat. Used in place of a plain
 * `<Textarea>` so we can inline `@board` mention chips.
 *
 * The editor is intentionally minimal: paragraphs only (no headings,
 * lists, blockquotes, code blocks — `chat-style` configuration of
 * StarterKit). It feels like a textarea but renders mention chips and
 * supports Enter-to-submit / Shift-Enter for newline.
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
    // Server-render guard recommended by Tiptap so Next.js doesn't
    // mount the editor on the server (the dom is browser-only).
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // We don't want the chat composer to look like a markdown
        // editor — strip the block tools that don't belong in a
        // single-line chat input.
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
        // Show the placeholder in the empty document only, not in
        // every empty paragraph (it's a single-paragraph composer).
        showOnlyWhenEditable: true,
      }),
      mentionExtension,
    ],
    editorProps: {
      attributes: {
        // Match the look of the previous Textarea: same min-height,
        // same padding, same focus ring removal — feels native.
        class: cn(
          "prose-tiptap chat-composer min-h-9 max-h-40 w-full resize-none overflow-y-auto",
          "bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none",
          "rounded-md border border-input",
        ),
      },
      handleKeyDown(_view, event) {
        if (event.key === "Enter" && !event.shiftKey) {
          // Don't intercept Enter while the suggestion popover is
          // open — its `onKeyDown` already swallowed the event in
          // that case. We only handle Enter when no suggestion is
          // visible (i.e. plain submit).
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
      const ids = collectMentionIds(editor.getJSON());
      selectedIdsRef.current = ids;
      onChange?.({ isEmpty: editor.isEmpty, mentionCount: ids.length });
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
      getMentionedBoardIds: () =>
        editor ? collectMentionIds(editor.getJSON()) : [],
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
 * Walk a Tiptap JSON document and collect every `mention` node's id
 * attribute, dedup'd. Used for both the per-message payload and the
 * already-mentioned dimming inside the suggestion popover.
 */
function collectMentionIds(doc: unknown): string[] {
  const ids = new Set<string>();
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] };
    if (obj.type === "mention" && typeof obj.attrs?.id === "string") {
      ids.add(obj.attrs.id);
    }
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) visit(child);
    }
  }
  visit(doc);
  return Array.from(ids);
}

/**
 * Detect whether the suggestion plugin is currently rendering its
 * popover. The decoration node carries `data-suggestion` (set by
 * tiptap's Mention extension by default) — testing for it in the
 * live DOM is cheaper than wiring a piece of React state through.
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
