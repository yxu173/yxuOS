"use client";

import { Check, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ChatMarkdown } from "@/components/board/chat-markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { updateResearchNote } from "@/app/(app)/research/actions";
import { HandoffToPlannerButton } from "./handoff-to-planner-button";

export interface ResearchNoteEditorProps {
  noteId: string;
  initialTitle: string;
  /** Real-time title from the server — takes precedence over initialTitle. */
  streamedTitle?: string | null;
  initialBody: string;
  /**
   * Project slug so the handoff button can route to the new plan
   * under the correct project.
   */
  projectSlug: string;
}

/**
 * Left-pane editor for a research note.
 *
 * Two modes — read and edit — toggled with one button. Read mode
 * renders Markdown via `ChatMarkdown` (same renderer the chat uses,
 * so headings, links, and code blocks all match). Edit mode swaps in
 * a textarea so the user can hand-edit the agent's draft.
 *
 * Saves are explicit (the "Save" button) rather than debounced
 * because the agent ALSO writes into this body via tool calls; an
 * always-saving editor would race with the server-side `update_
 * research_note` mutation. Explicit-save makes it clear who's
 * driving when.
 *
 * The title sits above the body; clicking it inline-edits, blur or
 * Enter saves.
 */
export function ResearchNoteEditor({
  noteId,
  initialTitle,
  streamedTitle,
  initialBody,
  projectSlug,
}: ResearchNoteEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  // Controlled body; resyncs from the prop whenever the parent
  // re-renders with new server-fetched content (agent wrote in via
  // tool, sibling tab edited, etc.). The `initialBody` dep guards
  // against stomping in-progress local edits.
  const [body, setBody] = useState(initialBody);
  const lastSyncedBody = useRef(initialBody);
  useEffect(() => {
    if (initialBody !== lastSyncedBody.current && !editing) {
      setBody(initialBody);
      lastSyncedBody.current = initialBody;
    }
  }, [initialBody, editing]);

  // Title gets the same treatment, but inline-editable in both modes.
  const [title, setTitle] = useState(initialTitle);
  const lastSyncedTitle = useRef(initialTitle);
  useEffect(() => {
    if (initialTitle !== lastSyncedTitle.current) {
      setTitle(initialTitle);
      lastSyncedTitle.current = initialTitle;
    }
  }, [initialTitle]);
  // Sync a server-streamed auto-title into local editable state.
  // This is the standard prop-to-state mirror pattern used throughout
  // the codebase (see inline-text-edit.tsx, flow-overlay.tsx, etc.).
  useEffect(() => {
    if (streamedTitle && streamedTitle !== title) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(streamedTitle);
      lastSyncedTitle.current = streamedTitle;
    }
  // We intentionally depend on `title` so the effect only fires when the
  // values differ, preventing unnecessary re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamedTitle]);

  const saveBody = () => {
    if (body === lastSyncedBody.current) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateResearchNote({ id: noteId, body });
        lastSyncedBody.current = body;
        setEditing(false);
        router.refresh();
      } catch (err) {
        console.error("[research-note] save failed", err);
        alert(
          err instanceof Error ? err.message : "Failed to save the note.",
        );
      }
    });
  };

  const saveTitle = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === lastSyncedTitle.current) return;
    startTransition(async () => {
      try {
        await updateResearchNote({ id: noteId, title: trimmed });
        lastSyncedTitle.current = trimmed;
        router.refresh();
      } catch (err) {
        console.error("[research-note] title save failed", err);
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title strip */}
      <div className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={(event) => saveTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          maxLength={200}
          className="flex-1 bg-transparent text-xl font-semibold tracking-tight text-zinc-50 placeholder:text-zinc-700 focus:outline-none"
          placeholder="Untitled research"
        />
        <HandoffToPlannerButton
          noteId={noteId}
          noteTitle={title}
          projectSlug={projectSlug}
        />
        <Button
          type="button"
          size="sm"
          variant={editing ? "default" : "ghost"}
          onClick={() => (editing ? saveBody() : setEditing(true))}
          disabled={pending}
          className="gap-1.5"
        >
          {editing ? (
            <>
              <Check className="size-3.5" />
              {pending ? "Saving…" : "Save"}
            </>
          ) : (
            <>
              <Pencil className="size-3.5" />
              Edit
            </>
          )}
        </Button>
      </div>

      {/* Body */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-6 py-6",
          // Slightly tighter padding when editing so the textarea has
          // more vertical room without feeling cramped.
          editing && "py-3",
        )}
      >
        {editing ? (
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={`# Question\nWhat are we trying to figure out?\n\n## Findings\n- bullet, citing [board:auth-flow]\n…`}
            className="h-full w-full resize-none rounded-md border border-white/10 bg-zinc-900/40 px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-700 focus:border-white/20 focus:outline-none"
            // Keep the textarea height filling the body area so the
            // scrollbar lives on the textarea (where the user
            // expects), not on the outer div.
            style={{ minHeight: "calc(100vh - 16rem)" }}
          />
        ) : body.trim().length === 0 ? (
          <EmptyBody />
        ) : (
          <article className="prose prose-invert max-w-none">
            <ChatMarkdown className="text-zinc-100">{body}</ChatMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}

function EmptyBody() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.015] px-5 py-6">
      <p className="text-sm text-zinc-400">
        This note is empty.
      </p>
      <p className="text-xs text-zinc-500">
        Ask the researcher a question on the right — it will pull from
        boards, designs, tasks, and the web, and write its findings
        here so you can revisit them later.
      </p>
    </div>
  );
}
