"use client";

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";

import { Whiteboard } from "@/components/board/whiteboard";
import { WorkspaceTopBar } from "@/components/workspaces/workspace-top-bar";
import type { WorkspaceSwitcherTeam } from "@/components/workspaces/workspace-switcher";

import { BoardName } from "./board-name";
import { Chat } from "./chat";
import { EditorRefProvider } from "./editor-context";
import { LeftPanel, type BoardSummary } from "./left-panel";
import { ShareDialog } from "./share-dialog";

export interface BoardShellProps {
  boardId: string;
  boardName: string;
  userName: string;
  userEmail?: string;
  shareToken: string | null;
  initialSnapshot: Record<string, unknown> | null;
  boards: BoardSummary[];
  initialMessages: UIMessage[];
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
  creator: { name: string; username: string | null } | null;
}

export function BoardShell({
  boardId,
  boardName,
  userName,
  userEmail,
  shareToken,
  initialSnapshot,
  boards,
  initialMessages,
  teams,
  activeTeamId,
  creator,
}: BoardShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

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

  return (
    <EditorRefProvider>
      <div className="fixed inset-0 flex flex-col bg-background">
        <WorkspaceTopBar
          homePath="/boards"
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
            <LeftPanel boards={boards} activeBoardId={boardId} />
          ) : null}

          <main className="relative flex-1 overflow-hidden">
            <Whiteboard boardId={boardId} initialSnapshot={initialSnapshot} />
          </main>

          {rightOpen ? (
            <Chat boardId={boardId} initialMessages={initialMessages} />
          ) : null}
        </div>
      </div>
    </EditorRefProvider>
  );
}
