"use client";

import { useDesignCanvas } from "./canvas-store";
import { DesignRenderer } from "./design-renderer";
import { DesignRendererProvider } from "./design-renderer-context";
import { DEVICE_DIMENSIONS, type Artboard } from "./types";

export interface ArtboardViewProps {
  artboard: Artboard;
  /**
   * Screen-space pointer-down handler — used by CanvasViewport to start a
   * drag of the artboard.
   */
  onPointerDownArtboard: (event: React.PointerEvent, id: string) => void;
}

/**
 * One artboard rendered in world space. Responsible for:
 * - positioning itself absolutely at (artboard.x, artboard.y)
 * - sizing itself to (artboard.w × artboard.h)
 * - rendering a small device label header
 * - rendering the design tree (or a placeholder until commit 4)
 *
 * The actual selection chrome lives in `<SelectionOverlay>` so it can be
 * drawn ABOVE all artboards and not affect this component's layout.
 */
export function ArtboardView({
  artboard,
  onPointerDownArtboard,
}: ArtboardViewProps) {
  const isSelected = useDesignCanvas((state) =>
    state.selection.includes(artboard.id),
  );
  const selectedNodeId = useDesignCanvas((state) => state.selectedNodeId);
  const selectNode = useDesignCanvas((state) => state.selectNode);
  const deviceLabel =
    artboard.device === "custom"
      ? `${artboard.w} × ${artboard.h}`
      : (DEVICE_DIMENSIONS[artboard.device]?.label ??
        `${artboard.w} × ${artboard.h}`);

  return (
    <div
      data-artboard-id={artboard.id}
      className="absolute"
      style={{
        left: artboard.x,
        top: artboard.y,
        width: artboard.w,
        height: artboard.h,
      }}
      onPointerDown={(event) => onPointerDownArtboard(event, artboard.id)}
    >
      {/* Header: device label + name */}
      <div
        className="absolute -top-9 left-0 flex items-center gap-2 whitespace-nowrap"
        style={{ fontSize: 14 }}
      >
        <span
          className={
            isSelected
              ? "rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-200"
              : "text-xs text-zinc-400"
          }
        >
          {artboard.name}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          {deviceLabel}
        </span>
      </div>

      {/* Frame — `data-artboard-frame-id` lets the screenshot tool grab
          just the rendered surface (without the floating header) by id. */}
      <div
        data-artboard-frame-id={artboard.id}
        className="relative h-full w-full overflow-hidden rounded-md"
        style={{
          background: artboard.background ?? "#ffffff",
          boxShadow: isSelected
            ? "0 0 0 2px rgb(59 130 246), 0 24px 80px rgb(0 0 0 / 0.5)"
            : "0 24px 80px rgb(0 0 0 / 0.4)",
        }}
      >
        {artboard.design ? (
          <div className="h-full w-full overflow-hidden">
            <DesignRendererProvider
              selectedNodeId={selectedNodeId}
              onNodeClick={(nodeId) => selectNode(nodeId)}
            >
              <DesignRenderer node={artboard.design} />
            </DesignRendererProvider>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-400">
            <span className="text-base font-medium">{artboard.name}</span>
            <span className="text-xs uppercase tracking-wide">
              {artboard.w} × {artboard.h}
            </span>
            <span className="mt-3 text-[11px] text-zinc-500">Empty artboard</span>
          </div>
        )}
      </div>
    </div>
  );
}
