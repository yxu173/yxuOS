"use client";

import { useState } from "react";

import { Whiteboard } from "@/components/board/whiteboard";

import { Chat } from "./chat";
import { LeftPanel, type BoardSummary } from "./left-panel";
import { TopBar } from "./top-bar";

export interface BoardShellProps {
  boardId: string;
  boardName: string;
  userName: string;
  initialSnapshot: Record<string, unknown> | null;
  boards: BoardSummary[];
}

export function BoardShell({
  boardId,
  boardName,
  userName,
  initialSnapshot,
  boards,
}: BoardShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <TopBar
        boardName={boardName}
        userName={userName}
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

        {rightOpen ? <Chat boardId={boardId} /> : null}
      </div>
    </div>
  );
}
