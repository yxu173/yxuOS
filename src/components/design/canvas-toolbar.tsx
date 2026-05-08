"use client";

import {
  Maximize2,
  Plus,
  Route,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { nanoid } from "nanoid";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { MAX_ZOOM, MIN_ZOOM, useDesignCanvas } from "./canvas-store";
import { SAMPLE_LANDING } from "./sample-design";
import { DEVICE_DIMENSIONS, type DevicePreset } from "./types";

export function CanvasToolbar() {
  const camera = useDesignCanvas((state) => state.camera);
  const zoomAt = useDesignCanvas((state) => state.zoomAt);
  const setCamera = useDesignCanvas((state) => state.setCamera);
  const artboards = useDesignCanvas((state) => state.artboards);
  const addArtboard = useDesignCanvas((state) => state.addArtboard);
  const selectOnly = useDesignCanvas((state) => state.selectOnly);
  const updateArtboardDesign = useDesignCanvas(
    (state) => state.updateArtboardDesign,
  );
  const selection = useDesignCanvas((state) => state.selection);
  const flowViewEnabled = useDesignCanvas((state) => state.flowViewEnabled);
  const setFlowViewEnabled = useDesignCanvas(
    (state) => state.setFlowViewEnabled,
  );

  const showDevTools =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SHOW_DEV_TOOLBAR === "1";

  const screenCenter = () => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  };

  const onZoom = (factor: number) => {
    const { x, y } = screenCenter();
    zoomAt(x, y, factor);
  };

  const onFit = () => {
    if (artboards.length === 0) {
      setCamera({ x: 200, y: 200, zoom: 0.5 });
      return;
    }
    const minX = Math.min(...artboards.map((a) => a.x));
    const minY = Math.min(...artboards.map((a) => a.y));
    const maxX = Math.max(...artboards.map((a) => a.x + a.w));
    const maxY = Math.max(...artboards.map((a) => a.y + a.h));
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
    setCamera({
      x: -minX * zoom + (screenW - w * zoom) / 2 + 320,
      y: -minY * zoom + (screenH - h * zoom) / 2 + 60,
      zoom,
    });
  };

  const onInsertSample = () => {
    // Either patch the selected artboard or drop a fresh desktop with the
    // sample tree. Used during dev to verify <DesignRenderer> end-to-end.
    if (selection.length > 0) {
      for (const id of selection) {
        updateArtboardDesign(id, SAMPLE_LANDING);
      }
      return;
    }
    const dimensions = DEVICE_DIMENSIONS.desktop;
    const rightmost =
      artboards.length === 0
        ? null
        : artboards.reduce((acc, a) =>
            a.x + a.w > acc.x + acc.w ? a : acc,
          );
    const x = rightmost ? rightmost.x + rightmost.w + 80 : 0;
    const y = rightmost ? rightmost.y : 0;
    const id = nanoid();
    addArtboard({
      id,
      name: "Stride landing — Desktop",
      device: "desktop",
      x,
      y,
      w: dimensions.w,
      // Tall enough for the sample landing-page tree.
      h: 1800,
      design: SAMPLE_LANDING,
    });
    selectOnly(id);
  };

  const onAddArtboard = (preset: Exclude<DevicePreset, "custom">) => {
    const dimensions = DEVICE_DIMENSIONS[preset];
    // Place new artboard to the right of the rightmost existing artboard,
    // or at world (0, 0) on an empty canvas.
    const rightmost =
      artboards.length === 0
        ? null
        : artboards.reduce((acc, a) =>
            a.x + a.w > acc.x + acc.w ? a : acc,
          );
    const x = rightmost ? rightmost.x + rightmost.w + 80 : 0;
    const y = rightmost ? rightmost.y : 0;
    const id = nanoid();
    addArtboard({
      id,
      name: dimensions.label.split(" · ")[0] ?? "Artboard",
      device: preset,
      x,
      y,
      w: dimensions.w,
      h: dimensions.h,
      design: null,
    });
    selectOnly(id);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/80 p-1 shadow-xl backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onZoom(0.8)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="size-4" />
        </Button>
        <span className="px-1.5 font-mono text-xs text-zinc-300">
          {Math.round(camera.zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onZoom(1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn className="size-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onFit}
          title="Fit to screen"
          aria-label="Fit to screen"
        >
          <Maximize2 className="size-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setFlowViewEnabled(!flowViewEnabled)}
          title={flowViewEnabled ? "Hide flow arrows" : "Show flow arrows"}
          aria-label={
            flowViewEnabled ? "Hide flow arrows" : "Show flow arrows"
          }
          aria-pressed={flowViewEnabled}
          className={cn(
            // Active state: blue tint to mirror the arrow color so the
            // toggle reads as "the same kind of thing the canvas just
            // started showing".
            flowViewEnabled && "bg-blue-500/20 text-blue-300 hover:bg-blue-500/25",
          )}
        >
          <Route className="size-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              title="Add artboard"
            >
              <Plus className="size-3.5" />
              Artboard
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(
              [
                "desktop",
                "laptop",
                "tablet",
                "mobile",
              ] as const
            ).map((preset) => (
              <DropdownMenuItem
                key={preset}
                onSelect={() => onAddArtboard(preset)}
              >
                {DEVICE_DIMENSIONS[preset].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {showDevTools ? (
          <>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={onInsertSample}
              title="Insert sample landing-page design (dev)"
            >
              <Sparkles className="size-3.5" />
              Sample
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
