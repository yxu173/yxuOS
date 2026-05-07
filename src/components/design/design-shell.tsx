"use client";

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";

import type {
  CommentItemData,
  MentionTarget,
} from "@/components/comments/types";
import { WorkspaceTopBar } from "@/components/workspaces/workspace-top-bar";
import type { WorkspaceSwitcherTeam } from "@/components/workspaces/workspace-switcher";

import { CanvasViewport } from "./canvas-viewport";
import { useDesignCanvas, MAX_ZOOM, MIN_ZOOM } from "./canvas-store";
import {
  ComponentLibraryProvider,
  type LibraryAsset,
  type LibraryComponent,
} from "./component-library-context";
import {
  DesignLeftPanel,
  type DesignSummary,
} from "./design-left-panel";
import { DesignName } from "./design-name";
import { DesignShareDialog } from "./design-share-dialog";
import { DesignRightPanel } from "./right-panel";
import type { Artboard } from "./types";
import { useDesignPersistence } from "./use-design-persistence";

export interface DesignShellProps {
  designId: string;
  designName: string;
  userName: string;
  userEmail?: string;
  shareToken: string | null;
  initialArtboards: Artboard[];
  initialMessages: UIMessage[];
  initialComments: CommentItemData[];
  members: MentionTarget[];
  designs: DesignSummary[];
  components: LibraryComponent[];
  assets: LibraryAsset[];
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
  creator: { name: string; username: string | null } | null;
}

export function DesignShell({
  designId,
  designName,
  userName,
  userEmail,
  shareToken,
  initialArtboards,
  initialMessages,
  initialComments,
  members,
  designs,
  components,
  assets,
  teams,
  activeTeamId,
  creator,
}: DesignShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Hydrate the zustand store with the server-fetched artboards on first
  // render via a lazy initializer (no flash of empty canvas).
  useState(() => {
    useDesignCanvas.getState().setArtboards(initialArtboards);
    return null;
  });

  // Debounced snapshot save on every artboard mutation.
  useDesignPersistence(designId);

  // Keyboard shortcuts:
  // - ⌘\ toggles left panel, ⌘/ toggles right.
  // - ⌘0 fits all artboards, ⌘= zooms in, ⌘- zooms out.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "\\") {
        event.preventDefault();
        setLeftOpen((value) => !value);
      } else if (event.key === "/") {
        event.preventDefault();
        setRightOpen((value) => !value);
      } else if (event.key === "0") {
        event.preventDefault();
        fitAll();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomCenter(1.25);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomCenter(0.8);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <ComponentLibraryProvider components={components} assets={assets}>
      <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      <WorkspaceTopBar
        homePath="/designs"
        homeLabel="Designs"
        leftPanelLabel="designs"
        nameSlot={<DesignName designId={designId} initialName={designName} />}
        shareSlot={
          <DesignShareDialog
            designId={designId}
            initialShareToken={shareToken}
          />
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
          <DesignLeftPanel designs={designs} activeDesignId={designId} />
        ) : null}
        <main className="relative flex-1 overflow-hidden">
          <CanvasViewport />
        </main>
        {rightOpen ? (
          <DesignRightPanel
            designId={designId}
            initialMessages={initialMessages}
            initialComments={initialComments}
            members={members}
          />
        ) : null}
      </div>
      </div>
    </ComponentLibraryProvider>
  );
}

/* ─── Keyboard helpers ─── */

function zoomCenter(factor: number) {
  if (typeof window === "undefined") return;
  useDesignCanvas
    .getState()
    .zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
}

function fitAll() {
  if (typeof window === "undefined") return;
  const state = useDesignCanvas.getState();
  if (state.artboards.length === 0) {
    state.setCamera({ x: 200, y: 200, zoom: 0.5 });
    return;
  }
  const minX = Math.min(...state.artboards.map((a) => a.x));
  const minY = Math.min(...state.artboards.map((a) => a.y));
  const maxX = Math.max(...state.artboards.map((a) => a.x + a.w));
  const maxY = Math.max(...state.artboards.map((a) => a.y + a.h));
  const w = maxX - minX;
  const h = maxY - minY;
  const padding = 200;
  const screenW = window.innerWidth - 320 - 384;
  const screenH = window.innerHeight - 60;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(screenW / (w + padding), screenH / (h + padding)),
    ),
  );
  state.setCamera({
    x: -minX * zoom + (screenW - w * zoom) / 2 + 320,
    y: -minY * zoom + (screenH - h * zoom) / 2 + 60,
    zoom,
  });
}
