"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { UserMenu } from "./user-menu";

export interface WorkspaceTopBarProps {
  /** URL of the workspace index (e.g. "/boards" or "/designs"). */
  homePath: string;
  /** Label for the workspace breadcrumb between yxuOS and the name. */
  homeLabel: string;
  /** The name component (with whatever inline-rename UX it implements). */
  nameSlot: React.ReactNode;
  /** The share dialog component (boards or designs flavour). */
  shareSlot?: React.ReactNode;
  userName: string;
  userEmail?: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  /** Shown in the left toggle's tooltip (e.g. "chats", "designs"). */
  leftPanelLabel?: string;
  /** Shown in the right toggle's tooltip (e.g. "chat"). */
  rightPanelLabel?: string;
}

/**
 * Shared chrome for the top of every workspace surface (boards and designs).
 *
 * The bits that differ across surfaces — the name component, the share
 * dialog, the breadcrumb label — come in as slots / props. Everything
 * else (panel toggles, user menu, yxuOS link) is identical.
 */
export function WorkspaceTopBar({
  homePath,
  homeLabel,
  nameSlot,
  shareSlot,
  userName,
  userEmail,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelLabel = "panel",
  rightPanelLabel = "chat",
}: WorkspaceTopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/60 px-2 backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleLeftPanel}
        title={
          leftPanelOpen
            ? `Hide ${leftPanelLabel} (⌘\\)`
            : `Show ${leftPanelLabel} (⌘\\)`
        }
        aria-label={
          leftPanelOpen ? `Hide ${leftPanelLabel} panel` : `Show ${leftPanelLabel} panel`
        }
      >
        {leftPanelOpen ? (
          <PanelLeftClose className="size-4" />
        ) : (
          <PanelLeftOpen className="size-4" />
        )}
      </Button>

      <Link
        href="/"
        className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
      >
        yxuOS
      </Link>
      <span className="text-zinc-600">/</span>
      <Link
        href={homePath}
        className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      >
        {homeLabel}
      </Link>
      <span className="text-zinc-600">/</span>
      {nameSlot}

      <div className="ml-auto flex items-center gap-1.5">
        {shareSlot}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRightPanel}
          title={
            rightPanelOpen
              ? `Hide ${rightPanelLabel} (⌘/)`
              : `Show ${rightPanelLabel} (⌘/)`
          }
          aria-label={
            rightPanelOpen
              ? `Hide ${rightPanelLabel} panel`
              : `Show ${rightPanelLabel} panel`
          }
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
