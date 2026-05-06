"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";

import { UserMenu } from "@/components/board/user-menu";
import { Button } from "@/components/ui/button";

import { DesignName } from "./design-name";
import { DesignShareDialog } from "./design-share-dialog";

export interface DesignTopBarProps {
  designId: string;
  designName: string;
  userName: string;
  userEmail?: string;
  shareToken: string | null;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

export function DesignTopBar({
  designId,
  designName,
  userName,
  userEmail,
  shareToken,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
}: DesignTopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/60 px-2 backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleLeftPanel}
        title={leftPanelOpen ? "Hide designs (⌘\\)" : "Show designs (⌘\\)"}
        aria-label={leftPanelOpen ? "Hide designs panel" : "Show designs panel"}
      >
        {leftPanelOpen ? (
          <PanelLeftClose className="size-4" />
        ) : (
          <PanelLeftOpen className="size-4" />
        )}
      </Button>

      <Link
        href="/designs"
        className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
      >
        yxuOS
      </Link>

      <span className="text-zinc-600">/</span>
      <Link
        href="/designs"
        className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      >
        Designs
      </Link>
      <span className="text-zinc-600">/</span>
      <DesignName designId={designId} initialName={designName} />

      <div className="ml-auto flex items-center gap-1.5">
        <DesignShareDialog
          designId={designId}
          initialShareToken={shareToken}
        />
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
