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
import { TokenProvider } from "./token-context";
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
  /** Base path used by the left panel for sibling design links. */
  designsHrefBase: string;
  /** Slug for the active project — used when the inline "+" creates a sibling. */
  projectSlug?: string;
  components: LibraryComponent[];
  assets: LibraryAsset[];
  /**
   * Initial design tokens — server-fetched team defaults +
   * per-design overrides. The provider keeps an optimistic overlay
   * on top so set_tokens / apply_theme propagate before
   * router.refresh() round-trips.
   */
  initialTokens: {
    team: Record<string, string | number>;
    design: Record<string, string | number>;
  };
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
  designsHrefBase,
  projectSlug,
  components,
  assets,
  initialTokens,
  teams,
  activeTeamId,
  creator,
}: DesignShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Hydrate the zustand store with the server-fetched artboards on the
  // first render of this DesignShell instance. Clears the undo stack
  // right after so the first user-visible state — what the server
  // sent — is the floor of the history (Cmd+Z can never roll to an
  // empty canvas "before the design loaded").
  //
  // We can't call `setArtboards` *during* render: zustand's `set`
  // synchronously notifies every subscriber, and any subscriber that
  // happens to be alive at that moment (e.g. <FlowOverlay/> kept
  // mounted across a route transition, or any node React's
  // StrictMode double-invoke pulls back into existence) ends up
  // taking a setState mid-DesignShell-render, which React 19 flags
  // as "Cannot update a component while rendering a different
  // component".
  //
  // Workaround: lazy-initialise once per mount via `useState`, but
  // *defer* the store mutation to a microtask. Microtasks drain
  // after the current React commit and before the browser paints,
  // so the user still sees the hydrated canvas on the first frame
  // (no empty-canvas flash) while React's render tree is no longer
  // on the stack when the subscriber notification fires.
  useState(() => {
    queueMicrotask(() => {
      useDesignCanvas.getState().setArtboards(initialArtboards);
      useDesignCanvas.temporal.getState().clear();
    });
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
      } else if (event.key === "z" || event.key === "Z") {
        // ⌘Z = undo, ⇧⌘Z = redo. The temporal store reverts only the
        // artboards slice; camera + selection keep current values.
        event.preventDefault();
        const temporal = useDesignCanvas.temporal.getState();
        if (event.shiftKey) {
          temporal.redo();
        } else {
          temporal.undo();
        }
      } else if (event.key === "y" || event.key === "Y") {
        // ⌘Y = redo (Windows convention; Mac users have ⇧⌘Z).
        event.preventDefault();
        useDesignCanvas.temporal.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <TokenProvider team={initialTokens.team} design={initialTokens.design}>
    <ComponentLibraryProvider components={components} assets={assets}>
      <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      <WorkspaceTopBar
        homePath={designsHrefBase}
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
          <DesignLeftPanel
            designs={designs}
            activeDesignId={designId}
            designsHrefBase={designsHrefBase}
            projectSlug={projectSlug ?? "workspace"}
          />
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
    </TokenProvider>
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
