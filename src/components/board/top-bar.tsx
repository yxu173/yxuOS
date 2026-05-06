"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { BoardName } from "./board-name";
import { ShareDialog } from "./share-dialog";
import { UserMenu } from "./user-menu";

export interface TopBarProps {
  boardId: string;
  boardName: string;
  userName: string;
  userEmail?: string;
  shareToken: string | null;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

export function TopBar({
  boardId,
  boardName,
  userName,
  userEmail,
  shareToken,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/60 px-2 backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleLeftPanel}
        title={leftPanelOpen ? "Hide chats (⌘\\)" : "Show chats (⌘\\)"}
        aria-label={leftPanelOpen ? "Hide chats panel" : "Show chats panel"}
      >
        {leftPanelOpen ? (
          <PanelLeftClose className="size-4" />
        ) : (
          <PanelLeftOpen className="size-4" />
        )}
      </Button>

      <Link
        href="/boards"
        className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
      >
        yxuOS
      </Link>

      <span className="text-zinc-600">/</span>

      <BoardName boardId={boardId} initialName={boardName} />

      <div className="ml-auto flex items-center gap-1.5">
        <ShareDialog boardId={boardId} initialShareToken={shareToken} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? "Hide chat (⌘/)" : "Show chat (⌘/)"}
          aria-label={rightPanelOpen ? "Hide chat panel" : "Show chat panel"}
        >
          {rightPanelOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </Button>
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
