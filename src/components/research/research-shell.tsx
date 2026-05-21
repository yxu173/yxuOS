"use client";

import { useState } from "react";
import type { UIMessage } from "ai";

import { ResearchChat } from "./research-chat";
import { ResearchNoteEditor } from "./research-note-editor";

export interface ResearchShellProps {
  noteId: string;
  initialTitle: string;
  initialBody: string;
  /** Project slug forwarded to children that need to route inside the project. */
  projectSlug: string;
  initialMessages: UIMessage[];
  /**
   * When the index page kicks the user into this shell after creating
   * a brand-new note, it forwards the original prompt via `?ask=...`.
   * The shell hands it to the chat which auto-sends on mount so the
   * user lands mid-conversation, not on a blank composer.
   */
  initialPrompt?: string;
}

/**
 * Two-pane research surface.
 *
 *   ┌──────────────── note (left) ────────────────┬─ chat (right) ─┐
 *   │ Title + Edit button                          │ Researcher     │
 *   │ Markdown body / textarea                     │ message stream │
 *   │                                              │ Composer       │
 *   └──────────────────────────────────────────────┴────────────────┘
 *
 * The right column is a fixed width so the doc gets the lion's share of
 * horizontal space; the chat is a sidebar, the doc is the artifact.
 */
export function ResearchShell({
  noteId,
  initialTitle,
  initialBody,
  projectSlug,
  initialMessages,
  initialPrompt,
}: ResearchShellProps) {
  // Real-time title from the server-side auto-title generator.
  const [streamedTitle, setStreamedTitle] = useState<string | null>(null);

  return (
    <div className="grid h-[calc(100vh-3rem)] min-h-0 w-full grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
      <section className="min-h-0 min-w-0 border-r border-white/5">
        <ResearchNoteEditor
          noteId={noteId}
          initialTitle={initialTitle}
          streamedTitle={streamedTitle}
          initialBody={initialBody}
          projectSlug={projectSlug}
        />
      </section>
      <aside className="min-h-0 min-w-0 bg-zinc-950/40">
        <ResearchChat
          noteId={noteId}
          initialMessages={initialMessages}
          initialPrompt={initialPrompt}
          onTitleUpdate={setStreamedTitle}
        />
      </aside>
    </div>
  );
}
