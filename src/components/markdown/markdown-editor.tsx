"use client";

import {
  Bold,
  Code,
  Eye,
  Heading,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  Loader2,
  Pencil,
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
import { MarkdownProse } from "@/components/markdown/markdown-prose";
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

type EditorMode = "edit" | "preview";

export interface MarkdownEditorHandle {
  focus: () => void;
  /** Insert text at the cursor (or replace the selection). */
  insertText: (text: string) => void;
  /** Returns the underlying textarea — use for imperative things like Cmd+Enter form submission. */
  getElement: () => HTMLTextAreaElement | null;
}

/**
 * Markdown editor with live image rendering.
 *
 * The default mode (`Edit`) shows both the textarea AND a live preview
 * stacked below it — paste an image (cmd+V from a screenshot tool, drag
 * from Finder, or click the toolbar button) and it appears in the
 * preview the moment the upload finishes. Toolbar shortcuts wrap the
 * current selection (bold / italic / code / link / list / heading) or
 * drop a starter snippet when nothing's selected.
 *
 * `Preview` mode hides the editor and just shows the rendered output —
 * useful for a clean read of long documents.
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
  const [mode, setMode] = useState<EditorMode>("edit");

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
      {/* Mode strip — Edit ↔ Preview. Always rendered (even when the
          toolbar is hidden) because the whole point of preview is to see
          rendered output, including images, without saving. */}
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Editor mode"
          className="inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] p-0.5 text-xs"
        >
          <ModeTab
            label="Edit"
            icon={Pencil}
            active={mode === "edit"}
            onClick={() => setMode("edit")}
          />
          <ModeTab
            label="Preview"
            icon={Eye}
            active={mode === "preview"}
            onClick={() => setMode("preview")}
          />
        </div>
        <span className="text-[10px] text-zinc-500">
          {mode === "edit"
            ? "Paste / drop images · markdown renders below"
            : "Read-only render of the markdown"}
        </span>
      </div>

      {mode === "edit" ? (
        <>
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
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            id={id}
            value={value}
            rows={rows}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={
              placeholder ?? "Write a description… **markdown** is supported."
            }
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            onPaste={onPaste}
            onKeyDown={(event) => {
              // ⌘⇧P toggles preview-only, ⌘B / ⌘I are inline-format shortcuts.
              if (event.metaKey || event.ctrlKey) {
                const key = event.key.toLowerCase();
                if (event.shiftKey && key === "p") {
                  event.preventDefault();
                  setMode("preview");
                  return;
                }
                if (!event.shiftKey && key === "b") {
                  event.preventDefault();
                  wrapSelection("**", "**", "bold text");
                  return;
                }
                if (!event.shiftKey && key === "i") {
                  event.preventDefault();
                  wrapSelection("*", "*", "italic text");
                  return;
                }
              }
              onKeyDown?.(event);
            }}
            className="min-h-32 resize-y bg-zinc-900/60 font-sans text-sm leading-relaxed text-zinc-100"
          />

          {/* Live preview — appears the moment the user types or finishes
              an image upload. Hidden until there's something to render so
              the editor doesn't waste space on an empty box. */}
          {value.trim().length > 0 ? (
            <div
              role="region"
              aria-label="Live preview"
              className="rounded-md border border-white/5 bg-white/[0.02] px-4 py-3"
            >
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Live preview
              </p>
              <MarkdownProse>{value}</MarkdownProse>
            </div>
          ) : null}
        </>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="Markdown preview"
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === "p"
            ) {
              event.preventDefault();
              setMode("edit");
              requestAnimationFrame(() => textareaRef.current?.focus());
            }
          }}
          className="min-h-32 rounded-md border border-white/10 bg-zinc-900/40 px-4 py-3 outline-none focus-visible:border-zinc-500/40"
        >
          {value.trim().length > 0 ? (
            <MarkdownProse>{value}</MarkdownProse>
          ) : (
            <p className="text-sm text-zinc-500">
              Nothing to preview yet. Switch back to <strong>Edit</strong> and
              start typing — anything you write here will render with your
              images, headings, code blocks, and links.
            </p>
          )}
        </div>
      )}

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

interface ModeTabProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}

function ModeTab({ label, icon: Icon, active, onClick }: ModeTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-white/10 text-zinc-50"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

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
