"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  createBoardMentionExtension,
  type BoardMentionConfig,
} from "@/components/design/board-mention-extension";
import type { BoardMentionItem } from "@/components/design/board-mention-suggestion";
import {
  Bold,
  Code,
  Heading,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Strikethrough,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { uploadAttachment } from "@/app/(app)/attachments/actions";
import { cn } from "@/lib/utils";

export interface RichTextEditorProps {
  /** Initial HTML content. Pass markdown-derived HTML for legacy bodies. */
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  /** Hide the toolbar — paste / drop image upload still works. */
  hideToolbar?: boolean;
  /** Lift focus onto the editor when it mounts. */
  autoFocus?: boolean;
  /** Read-only render (e.g. embedded inside read-only contexts). */
  editable?: boolean;
  /** Tighter min-height for compact contexts like the comment composer. */
  compact?: boolean;
  /** Max body height before the editor area scrolls internally. */
  maxBodyHeight?: number;
  /**
   * When true, the toolbar is hidden until the editor has focus.
   * Keeps surfaces (like the create-task dialog) visually quiet for
   * the common one-line-description case while still surfacing the
   * full toolbar the moment the user actually starts writing.
   *
   * Has no effect when {@link RichTextEditorProps.hideToolbar} is set.
   */
  revealToolbarOnFocus?: boolean;
  /**
   * Drop the bordered / tinted rectangle around the editor body.
   * Useful when the parent already provides visual containment
   * (modal panel, card) and the inner box reads as redundant.
   * The body keeps its inner padding either way so the cursor
   * doesn't sit flush against the outer surface.
   */
  borderless?: boolean;
  /**
   * When set, enables `@board-name` mentions inside the editor.
   *
   *  - `projectSlug` — used to boost boards from the same project to
   *    the top of the suggestion list and (in `RichTextRender`) to
   *    build clickable links.
   *  - The mention extension is registered with the editor's schema
   *    so saved HTML carries `<span data-mention-kind="board"
   *    data-id="…">@<name></span>` nodes; nothing else needs to
   *    change for round-tripping.
   *
   * Leave undefined to opt out (default for plain comments / notes).
   */
  boardMentions?: { projectSlug: string };
}

/**
 * WYSIWYG rich-text editor backed by TipTap / ProseMirror.
 *
 * - Outputs HTML via `onChange` so the saved body is renderer-agnostic
 *   (we store the editor's HTML straight to the DB).
 * - Pastes, drops, and toolbar uploads route images through
 *   {@link uploadAttachment}; on success the returned URL becomes an
 *   inline `<img>` node in the document — which is exactly what the
 *   user sees while still composing. No markdown text leaks into the
 *   editor.
 * - Toolbar covers bold / italic / strike / inline code / heading /
 *   list / ordered list / blockquote / link / image. Inline shortcuts
 *   (cmd+B, cmd+I, etc.) come from StarterKit.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  hideToolbar = false,
  autoFocus = false,
  editable = true,
  compact = false,
  maxBodyHeight,
  boardMentions,
  revealToolbarOnFocus = false,
  borderless = false,
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from `editor.isFocused` because tiptap doesn't
  // re-render React when its internal focus state changes — we drive
  // it ourselves from the onFocus / onBlur lifecycle callbacks below.
  const [isFocused, setIsFocused] = useState(false);

  // Depend on the primitive `projectSlug` so a parent that re-creates
  // the `boardMentions` object on each render doesn't tear down and
  // remount the entire editor. (`useMemo` / `useCallback` below close
  // over this scalar.)
  const mentionsProjectSlug = boardMentions?.projectSlug ?? null;

  // Stable search callback for the board-mention popover. Closes over
  // `projectSlug` so the same project's boards float to the top of the
  // suggestion list. Built lazily — if `boardMentions` is undefined we
  // never call this and never register the extension.
  const searchBoards = useCallback(
    async (query: string): Promise<BoardMentionItem[]> => {
      if (!mentionsProjectSlug) return [];
      try {
        const url = new URL(
          "/api/mentions/boards",
          window.location.origin,
        );
        if (query) url.searchParams.set("q", query);
        url.searchParams.set("projectSlug", mentionsProjectSlug);
        const res = await fetch(url.toString(), {
          credentials: "same-origin",
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { boards?: BoardMentionItem[] };
        return json.boards ?? [];
      } catch {
        return [];
      }
    },
    [mentionsProjectSlug],
  );

  // Build the extension once per `boardMentions` toggle. Inside the
  // editor the description doesn't need a mention cap (unlike the chat
  // composer), so `getCapReached` always reports false. `getSelectedIds`
  // returns an empty array — we let the user re-mention the same board
  // multiple times because they may genuinely want to reference it from
  // different paragraphs.
  const mentionExtension = useMemo(() => {
    if (!mentionsProjectSlug) return null;
    const config: BoardMentionConfig = {
      searchBoards,
      getSelectedIds: () => [],
      getCapReached: () => false,
    };
    return createBoardMentionExtension(config);
  }, [mentionsProjectSlug, searchBoards]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Tighten the heading set — h1 in a task description tends to be
        // overkill; users get h2 / h3 from the toolbar and can drop a
        // markdown-style `# ` if they really want h1.
        heading: { levels: [1, 2, 3] },
        // StarterKit ships its own Link extension; disable it so we can
        // configure our own (autolink + open-in-new-tab) without
        // tripping the "duplicate extension names" runtime warning.
        link: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Add a description…",
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image.configure({
        HTMLAttributes: {
          class:
            "my-2 max-h-[60vh] max-w-full rounded-lg border border-white/10",
        },
      }),
      // Spread on a single-element array so a tuple `[ext]` flattens
      // when boardMentions is on, and `[]` cleanly omits the slot when
      // off. Adding `null` to the extensions array would crash tiptap.
      ...(mentionExtension ? [mentionExtension] : []),
    ],
    content: value || "",
    autofocus: autoFocus,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "prose-tiptap focus:outline-none",
          compact ? "min-h-16" : "min-h-32",
        ),
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const files: File[] = [];
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file && file.type.startsWith("image/")) files.push(file);
          }
        }
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAndInsert(files);
        return true;
      },
      handleDrop(_view, event, _slice, moved) {
        if (moved) return false;
        const files = (event as DragEvent).dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const images = Array.from(files).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (images.length === 0) return false;
        event.preventDefault();
        void uploadAndInsert(images);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onFocus: () => {
      setIsFocused(true);
    },
    onBlur: () => {
      setIsFocused(false);
      onBlur?.();
    },
  });

  /** Push a new initial value into the editor when the prop changes
   *  externally (e.g. after revalidation). Skipped when the user is
   *  actively editing — `editor.getHTML()` already matches `value` then. */
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  const uploadAndInsert = async (files: File[]) => {
    if (!editor || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadAttachment(fd);
        editor
          .chain()
          .focus()
          .setImage({ src: result.url, alt: result.name })
          // Drop a paragraph after every image so the cursor lands below
          // it — typing right after an inline image gets weird otherwise.
          .createParagraphNear()
          .run();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!editor) {
    return null;
  }

  // Toolbar visibility: always-on by default. With
  // `revealToolbarOnFocus` we collapse it when the user is not
  // actively writing — the body keeps its full height so the
  // dialog doesn't visibly jump as the toolbar comes and goes.
  const showToolbar =
    !hideToolbar && (!revealToolbarOnFocus || isFocused);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showToolbar ? (
        <Toolbar
          editor={editor}
          uploading={uploading}
          onPickImage={() => fileInputRef.current?.click()}
          onAttachLink={() => promptLink(editor)}
        />
      ) : null}

      <div
        className={cn(
          "rich-editor px-3 py-2 transition-colors",
          borderless
            ? "px-0 py-0"
            : "rounded-md border border-white/10 bg-zinc-900/40 focus-within:border-zinc-500/40",
          compact && !borderless && "px-2.5 py-1.5",
        )}
        style={
          maxBodyHeight
            ? { maxHeight: maxBodyHeight, overflowY: "auto" }
            : undefined
        }
      >
        <EditorContent editor={editor} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (!event.target.files) return;
          void uploadAndInsert(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

/* ─── toolbar ─────────────────────────────────────── */

function Toolbar({
  editor,
  uploading,
  onPickImage,
  onAttachLink,
}: {
  editor: Editor;
  uploading: boolean;
  onPickImage: () => void;
  onAttachLink: () => void;
}) {
  // Toolbar sits flush above the editor surface — no separate border or
  // background, so it reads as part of the same input rather than a
  // detached strip.
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <ToolbarBtn
        label="Bold"
        shortcut="⌘B"
        icon={Bold}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarBtn
        label="Italic"
        shortcut="⌘I"
        icon={Italic}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarBtn
        label="Strikethrough"
        icon={Strikethrough}
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarBtn
        label="Inline code"
        icon={Code}
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <span className="mx-1 h-4 w-px bg-white/10" />
      <ToolbarBtn
        label="Heading"
        icon={Heading}
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      />
      <ToolbarBtn
        label="Bullet list"
        icon={List}
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarBtn
        label="Ordered list"
        icon={ListOrdered}
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarBtn
        label="Quote"
        icon={Quote}
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <span className="mx-1 h-4 w-px bg-white/10" />
      <ToolbarBtn
        label="Link"
        icon={LinkIcon}
        active={editor.isActive("link")}
        onClick={onAttachLink}
      />
      <ToolbarBtn
        label={uploading ? "Uploading…" : "Image"}
        icon={uploading ? Loader2 : ImagePlus}
        iconClassName={uploading ? "animate-spin" : undefined}
        onClick={onPickImage}
        disabled={uploading}
      />
    </div>
  );
}

function ToolbarBtn({
  label,
  shortcut,
  icon: Icon,
  iconClassName,
  active,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  iconClassName?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded transition-colors",
        active
          ? "bg-white/10 text-zinc-50"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Icon className={cn("size-3.5", iconClassName)} />
    </button>
  );
}

/* ─── link prompt ─────────────────────────────────── */

function promptLink(editor: Editor) {
  const previous = editor.getAttributes("link").href as string | undefined;
  const next = window.prompt("Link URL (leave empty to remove)", previous ?? "");
  if (next === null) return; // cancelled
  if (next === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  // Auto-prefix bare domains with https:// so the link is valid.
  const href = /^[a-z][a-z0-9+.-]*:/i.test(next) ? next : `https://${next}`;
  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href })
    .run();
}
