"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";

import { Whiteboard } from "@/components/board/whiteboard";
import type {
  CommentItemData,
  MentionTarget,
} from "@/components/comments/types";
import { WorkspaceTopBar } from "@/components/workspaces/workspace-top-bar";
import type { WorkspaceSwitcherTeam } from "@/components/workspaces/workspace-switcher";

import { BoardName } from "./board-name";
import {
  EditorRefProvider,
  focusShape,
  readShapeLabel,
  selectNone,
  useBoardCanvasHandle,
  useBoardSelection,
} from "./editor-context";
import { LeftPanel, type BoardSummary } from "./left-panel";
import { BoardRightPanel } from "./right-panel";
import { ShareDialog } from "./share-dialog";

export interface BoardShellProps {
  boardId: string;
  boardName: string;
  userName: string;
  userEmail?: string;
  shareToken: string | null;
  initialSnapshot: Record<string, unknown> | null;
  boards: BoardSummary[];
  /** Base path used by the left panel for sibling links. */
  boardsHrefBase: string;
  /** Project slug used when the inline "+" in the left panel creates a sibling. */
  projectSlug: string;
  initialMessages: UIMessage[];
  initialComments: CommentItemData[];
  members: MentionTarget[];
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
  creator: { name: string; username: string | null } | null;
}

export function BoardShell(props: BoardShellProps) {
  return (
    <EditorRefProvider>
      <BoardShellInner {...props} />
    </EditorRefProvider>
  );
}

function BoardShellInner({
  boardId,
  boardName,
  userName,
  userEmail,
  shareToken,
  initialSnapshot,
  boards,
  boardsHrefBase,
  projectSlug,
  initialMessages,
  initialComments,
  members,
  teams,
  activeTeamId,
  creator,
}: BoardShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const handleRef = useBoardCanvasHandle();
  const { selectedShapeIds } = useBoardSelection();

  // Keyboard shortcuts: Cmd/Ctrl + \ → left panel, Cmd/Ctrl + / → right panel.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "\\") {
        event.preventDefault();
        setLeftOpen((value) => !value);
      } else if (event.key === "/") {
        event.preventDefault();
        setRightOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Pin new comments to the single selected shape, if any. Multi-select
  // doesn't pin (ambiguous which one to attach to).
  const selectedShapeId =
    selectedShapeIds.length === 1 ? selectedShapeIds[0] : null;

  // Track a friendly label for the selected shape — recomputed in an
  // effect so we never have to read editorRef.current during render.
  const [selectedShapeLabel, setSelectedShapeLabel] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setSelectedShapeLabel(
      selectedShapeId
        ? readShapeLabel(handleRef.current, selectedShapeId)
        : null,
    );
  }, [selectedShapeId, handleRef]);

  const onClearSelection = useCallback(() => {
    selectNone(handleRef.current);
  }, [handleRef]);

  const onFocusShape = useCallback(
    (shapeId: string) => {
      focusShape(handleRef.current, shapeId);
    },
    [handleRef],
  );

  // For per-comment "on …" pills we just show a generic label — resolving
  // each shape during render would need a live editor reference, which is
  // a render anti-pattern. Clicking the pill still focuses the shape.
  const resolveTargetLabel = useCallback(() => "shape", []);

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <WorkspaceTopBar
        homePath={boardsHrefBase}
        homeLabel="Boards"
        leftPanelLabel="chats"
        nameSlot={<BoardName boardId={boardId} initialName={boardName} />}
        shareSlot={
          <ShareDialog boardId={boardId} initialShareToken={shareToken} />
        }
        userName={userName}
        userEmail={userEmail}
        teams={teams}
        activeTeamId={activeTeamId}
        creator={creator}
        leftPanelOpen={leftOpen}
        rightPanelOpen={rightOpen}
        onToggleLeftPanel={() => setLeftOpen((value) => !value)}
        onToggleRightPanel={() => setRightOpen((value) => !value)}
      />

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <LeftPanel
            boards={boards}
            activeBoardId={boardId}
            boardsHrefBase={boardsHrefBase}
            projectSlug={projectSlug}
          />
        ) : null}

        <main className="relative flex-1 overflow-hidden">
          <Whiteboard boardId={boardId} initialSnapshot={initialSnapshot} />
        </main>

        {rightOpen ? (
          <BoardRightPanel
            boardId={boardId}
            initialMessages={initialMessages}
            initialComments={initialComments}
            members={members}
            selectedShapeId={selectedShapeId}
            onClearSelection={onClearSelection}
            onFocusShape={onFocusShape}
            resolveTargetLabel={resolveTargetLabel}
            selectedShapeLabel={selectedShapeLabel}
          />
        ) : null}
      </div>
    </div>
  );
}

// `readShapeLabel`, `selectNone`, `focusShape` live in
// `editor-context.tsx` — thin wrappers around the Excalidraw API
// imported here. Pre-Phase 4 they branched on `handle.engine` to
// route to one of two engines; after Phase 4 they're Excalidraw-only.
// The indirection still pays for itself: keeps the shell free of
// imperative API calls.
