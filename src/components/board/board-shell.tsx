"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import type { Editor } from "tldraw";

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
  useBoardEditorRef,
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
  const editorRef = useBoardEditorRef();
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
        ? readShapeLabel(editorRef.current, selectedShapeId)
        : null,
    );
  }, [selectedShapeId, editorRef]);

  const onClearSelection = useCallback(() => {
    editorRef.current?.selectNone();
  }, [editorRef]);

  const onFocusShape = useCallback(
    (shapeId: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const shape = editor.getShape(
        shapeId as Parameters<typeof editor.getShape>[0],
      );
      if (!shape) return;
      editor.select(shape.id);
      editor.zoomToSelection({ animation: { duration: 200 } });
    },
    [editorRef],
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

/**
 * Read the friendliest text label off a shape, falling back to its type.
 * Pulled out so the effect that mirrors selection state can use it
 * without adding a render-time ref read.
 */
function readShapeLabel(editor: Editor | null, shapeId: string): string {
  if (!editor) return "shape";
  const shape = editor.getShape(
    shapeId as Parameters<typeof editor.getShape>[0],
  );
  if (!shape) return "deleted shape";
  const props = shape.props as Record<string, unknown>;
  if (typeof props.text === "string" && props.text.trim()) {
    return truncate(props.text, 28);
  }
  if (typeof props.name === "string" && props.name.trim()) {
    return truncate(props.name, 28);
  }
  return shape.type;
}
