"use client";

import {
  Bold,
  Code,
  Heading,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type ClipboardEvent,
} from "react";

import { uploadAttachment } from "@/app/(app)/attachments/actions";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Hide the toolbar — image upload via paste / drop still works. */
  hideToolbar?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Forwarded id for label association. */
  id?: string;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  /** Insert text at the cursor (or replace the selection). */
  insertText: (text: string) => void;
  /** Returns the underlying textarea — use for imperative things like Cmd+Enter form submission. */
  getElement: () => HTMLTextAreaElement | null;
}

/**
 * Plain-text markdown editor with paste / drag-and-drop / button image
 * upload. Returns the raw markdown via `onChange` — pair with
 * {@link MarkdownProse} to render the saved output.
 *
 * - Paste an image (cmd+V from a screenshot tool, or drag from Finder)
 *   → uploaded to Vercel Blob and inserted as `![name](url)` at the
 *   cursor.
 * - Toolbar buttons wrap the current selection with the right markers
 *   (bold / italic / code / link / list / heading) or drop a starter
 *   snippet when nothing is selected.
 *
 * The editor stays a single textarea — no live preview here. The caller
 * decides whether to show preview separately.
 */
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    value,
    onChange,
    onBlur,
    onKeyDown,
    placeholder,
    rows = 6,
    className,
    hideToolbar = false,
    disabled,
    autoFocus,
    id,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Replace the current selection (or insert at the cursor) with `text`. */
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const caret = start + text.length;
      target.focus();
      target.setSelectionRange(caret, caret);
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      getElement: () => textareaRef.current,
      insertText: (text: string) => insertAtCursor(text),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Wrap the current selection with `before` / `after`; falls back to a placeholder when nothing's selected. */
  const wrapSelection = (
    before: string,
    after: string = before,
    placeholderText = "",
  ) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = value.slice(start, end);
    const inner = selected || placeholderText;
    const wrapped = `${before}${inner}${after}`;
    const next = value.slice(0, start) + wrapped + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      // Select the inner text so the user can immediately type to replace.
      const innerStart = start + before.length;
      target.setSelectionRange(innerStart, innerStart + inner.length);
    });
  };

  /** Insert a line-prefixed block (lists / headings). */
  const prefixLine = (prefix: string, placeholderText: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    // Find the start of the current line.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const before = value.slice(0, lineStart);
    const rest = value.slice(lineStart);
    const inserted = `${prefix}${placeholderText}`;
    onChange(`${before}${inserted}${rest}`);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(
        lineStart + prefix.length,
        lineStart + prefix.length + placeholderText.length,
      );
    });
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadAttachment(fd);
        const safeName = result.name.replace(/[\]\\]/g, "_");
        insertAtCursor(`\n![${safeName}](${result.url})\n`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.type.startsWith("image/")) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void uploadFiles(
      Array.from(event.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      ),
    );
  };

  const triggerImagePicker = () => fileInputRef.current?.click();

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {!hideToolbar ? (
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-white/5 bg-white/[0.02] px-1 py-1">
          <ToolbarButton
            label="Bold"
            shortcut="⌘B"
            icon={Bold}
            onClick={() => wrapSelection("**", "**", "bold text")}
            disabled={disabled}
          />
          <ToolbarButton
            label="Italic"
            shortcut="⌘I"
            icon={Italic}
            onClick={() => wrapSelection("*", "*", "italic text")}
            disabled={disabled}
          />
          <ToolbarButton
            label="Inline code"
            icon={Code}
            onClick={() => wrapSelection("`", "`", "code")}
            disabled={disabled}
          />
          <span className="mx-1 h-4 w-px bg-white/10" />
          <ToolbarButton
            label="Heading"
            icon={Heading}
            onClick={() => prefixLine("## ", "Heading")}
            disabled={disabled}
          />
          <ToolbarButton
            label="Bullet list"
            icon={List}
            onClick={() => prefixLine("- ", "List item")}
            disabled={disabled}
          />
          <span className="mx-1 h-4 w-px bg-white/10" />
          <ToolbarButton
            label="Link"
            icon={LinkIcon}
            onClick={() => wrapSelection("[", "](https://)", "link text")}
            disabled={disabled}
          />
          <ToolbarButton
            label={uploading ? "Uploading…" : "Image"}
            icon={uploading ? Loader2 : ImagePlus}
            iconClassName={uploading ? "animate-spin" : undefined}
            onClick={triggerImagePicker}
            disabled={disabled || uploading}
          />
          <span className="ml-auto text-[10px] text-zinc-500">
            Markdown supported · paste / drop images
          </span>
        </div>
      ) : null}

      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder ?? "Write a description… **markdown** is supported."}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onPaste={onPaste}
        onKeyDown={(event) => {
          // ⌘B / ⌘I shortcuts.
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
            const key = event.key.toLowerCase();
            if (key === "b") {
              event.preventDefault();
              wrapSelection("**", "**", "bold text");
              return;
            }
            if (key === "i") {
              event.preventDefault();
              wrapSelection("*", "*", "italic text");
              return;
            }
          }
          onKeyDown?.(event);
        }}
        className="min-h-32 resize-y bg-zinc-900/60 font-sans text-sm leading-relaxed text-zinc-100"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (!event.target.files) return;
          void uploadFiles(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
});

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  iconClassName?: string;
  onClick: () => void;
  disabled?: boolean;
}

function ToolbarButton({
  label,
  shortcut,
  icon: Icon,
  iconClassName,
  onClick,
  disabled,
}: ToolbarButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <Icon className={cn("size-3.5", iconClassName)} />
    </button>
  );
}
