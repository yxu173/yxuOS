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

import { BoardActions } from "./board-actions";
import { BoardName } from "./board-name";
import {
  EditorRefProvider,
  focusShape,
  readShapeLabel,
  selectNone,
  useBoardCanvasHandle,
  useBoardSelection,
  useBoardZoom,
} from "./editor-context";
import { LeftPanel, type BoardSummary } from "./left-panel";
import { LockOverlay } from "./lock-overlay";
import { MultiplayerCursors } from "./multiplayer-cursors";
import { BoardRightPanel } from "./right-panel";
import { ShareDialog } from "./share-dialog";
import { StickyClusters } from "./sticky-clusters";
import { useBoardLock } from "./use-board-lock";
import { useMultiplayerCursors } from "./use-multiplayer-cursors";

export interface BoardShellProps {
  boardId: string;
  boardName: string;
  userName: string;
  userEmail?: string;
  userId: string;
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
  userId,
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
  const [streamedTitle, setStreamedTitle] = useState<string | null>(null);
  const handleRef = useBoardCanvasHandle();
  const { selectedShapeIds } = useBoardSelection();

  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const canvasZoom = useBoardZoom();

  const {
    loading: lockLoading,
    lockedByOther,
    takeOver,
  } = useBoardLock(boardId);

  const { cursors } = useMultiplayerCursors(
    boardId,
    userId,
    userName,
    canvasEl,
    canvasZoom,
  );

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

  const selectedShapeId =
    selectedShapeIds.length === 1 ? selectedShapeIds[0] : null;

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

  const resolveTargetLabel = useCallback(() => "shape", []);

  const isLockedAway = lockedByOther !== null;

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <WorkspaceTopBar
        homePath={boardsHrefBase}
        homeLabel="Boards"
        leftPanelLabel="chats"
        nameSlot={
          <BoardName
            boardId={boardId}
            initialName={boardName}
            streamedTitle={streamedTitle}
          />
        }
        shareSlot={
          <ShareDialog boardId={boardId} initialShareToken={shareToken} />
        }
        actionsSlot={<BoardActions getHandle={() => handleRef.current} />}
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

        <main ref={setCanvasEl} className="relative flex-1 overflow-hidden">
          {isLockedAway ? (
            <LockOverlay
              lockedByName={lockedByOther.name}
              lockedByUsername={lockedByOther.username}
              loading={lockLoading}
              onTakeOver={takeOver}
            />
          ) : null}
          <Whiteboard boardId={boardId} initialSnapshot={initialSnapshot} />
          <MultiplayerCursors cursors={cursors} />
          <StickyClusters />
        </main>

        {isLockedAway ? null : (
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
            hidden={!rightOpen}
            onTitleUpdate={setStreamedTitle}
          />
        )}
      </div>
    </div>
  );
}
