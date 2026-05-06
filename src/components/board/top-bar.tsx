"use client";

import {
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export interface TopBarProps {
  boardName: string;
  userName: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

export function TopBar({
  boardName,
  userName,
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
        title={leftPanelOpen ? "Hide chats" : "Show chats"}
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

      <span className="truncate text-sm font-medium text-zinc-100">
        {boardName}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex">
          <span>signed in as</span>
          <span className="text-zinc-300">{userName}</span>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? "Hide chat" : "Show chat"}
          aria-label={rightPanelOpen ? "Hide chat panel" : "Show chat panel"}
        >
          {rightPanelOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </Button>
      </div>

      {/* Hidden duplicate icons retained for future feature wiring */}
      <span className="sr-only">
        <History className="size-4" />
        <MessageSquare className="size-4" />
      </span>
    </header>
  );
}
