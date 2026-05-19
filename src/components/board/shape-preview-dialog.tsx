"use client";

import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { MarkdownProse } from "@/components/markdown/markdown-prose";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { renderMermaid } from "./mermaid";

/** Hard limits so the user can't get lost off-screen. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

/**
 * Full-size, read-only preview for a single board card. The on-canvas
 * shape is constrained to whatever box the user (or agent) drew, which
 * makes long markdown notes scroll inside a 320×200 frame and mermaid
 * diagrams render tiny. This dialog re-renders the same content at up
 * to 90vw × 85vh so it can actually be read.
 *
 * Re-renders mermaid each time the dialog opens (or the source changes)
 * because the SVG is tied to its viewport — the on-card SVG is sized
 * for ~480×280 and would look pixelated when blown up.
 */
export type ShapePreviewKind =
  | { type: "markdown"; markdown: string }
  | { type: "mermaid"; mermaid: string; shapeId: string };

export interface ShapePreviewDialogProps {
  /** `null` = closed. */
  preview: ShapePreviewKind | null;
  onOpenChange: (open: boolean) => void;
}

export function ShapePreviewDialog({
  preview,
  onOpenChange,
}: ShapePreviewDialogProps) {
  const open = preview !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[90vw] max-w-[1100px] flex-col gap-0 overflow-hidden bg-zinc-950/95 p-0 sm:max-w-[1100px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">
          {preview?.type === "mermaid" ? "Diagram preview" : "Note preview"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Full-size preview of the selected board card.
        </DialogDescription>
        {preview?.type === "markdown" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            <MarkdownProse className="text-base leading-relaxed">
              {preview.markdown || "_(empty)_"}
            </MarkdownProse>
          </div>
        ) : preview?.type === "mermaid" ? (
          <MermaidPreview
            key={preview.shapeId}
            shapeId={preview.shapeId}
            source={preview.mermaid}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type MermaidResult =
  | { kind: "ok"; svg: string }
  | { kind: "err"; message: string };

function MermaidPreview({
  shapeId,
  source,
}: {
  shapeId: string;
  source: string;
}) {
  // Tag results with the source they came from so we never show a stale
  // SVG (and don't have to clear state synchronously inside the effect,
  // which the react-hooks rules rightly flag).
  const [result, setResult] = useState<
    (MermaidResult & { source: string }) | null
  >(null);
  const isStale = result === null || result.source !== source;
  const error = !isStale && result?.kind === "err" ? result.message : null;
  const svg = !isStale && result?.kind === "ok" ? result.svg : null;

  useEffect(() => {
    let cancelled = false;
    // Distinct render id from the on-card SVG so mermaid doesn't reuse
    // the cached one — important because the dialog SVG is sized to its
    // own container.
    const safeId = `mermaid-preview-${shapeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    renderMermaid(safeId, source)
      .then((rendered) => {
        if (cancelled) return;
        setResult({ kind: "ok", svg: rendered, source });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          kind: "err",
          message:
            err instanceof Error ? err.message : "Mermaid render failed",
          source,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [shapeId, source]);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-7">
        <pre className="max-w-full overflow-auto rounded-md border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-300">
          {`Mermaid error\n\n${error}`}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-400">
        Rendering diagram…
      </div>
    );
  }

  return <ZoomableSvg svg={svg} />;
}

/**
 * Mermaid SVG inside a zoom + pan viewport.
 *
 * Defaults to a "fit" zoom so the whole diagram is visible on open
 * (which is what the user expects from a preview dialog). After that
 * the user drives zoom with the toolbar, Ctrl/Cmd + wheel, and pan
 * with drag — same gestures Excalidraw uses, so muscle memory carries.
 *
 * The SVG itself is rendered at its **natural** size (we strip the
 * "fit container" CSS on purpose); zoom is applied via a CSS
 * `transform: scale()` on a wrapper, which is GPU-accelerated and
 * doesn't re-rasterise. Panning is just `overflow: auto` scrolling
 * mutated on pointer drag, so it composes for free with the native
 * scrollbars.
 */
function ZoomableSvg({ svg }: { svg: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  // Set once we've measured the SVG against the viewport so the first
  // paint can land on a sensible "fit-to-view" scale.
  const [autoFit, setAutoFit] = useState<number | null>(null);
  // Mirror of `panState.current != null` for use in render — reading
  // a ref during render is flagged by react-hooks/refs because it
  // doesn't trigger re-renders, so the cursor / transition wouldn't
  // flip without a state companion anyway.
  const [isPanning, setIsPanning] = useState(false);

  // Compute the fit-to-view scale: smallest of (viewport / svg) on
  // each axis, capped to 1 so small diagrams aren't blown up.
  const computeFitZoom = useCallback((): number => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return 1;
    const svgEl = content.querySelector("svg");
    if (!svgEl) return 1;
    // Read natural size from viewBox if present (mermaid sets one),
    // falling back to the rendered bounding box.
    const vb = svgEl.viewBox.baseVal;
    const naturalW = vb && vb.width > 0 ? vb.width : svgEl.clientWidth;
    const naturalH = vb && vb.height > 0 ? vb.height : svgEl.clientHeight;
    if (naturalW <= 0 || naturalH <= 0) return 1;
    const padding = 48; // leave a little breathing room
    const availW = viewport.clientWidth - padding;
    const availH = viewport.clientHeight - padding;
    if (availW <= 0 || availH <= 0) return 1;
    return Math.min(1, availW / naturalW, availH / naturalH);
  }, []);

  // Run the fit pass once the SVG markup has actually been committed
  // to the DOM (which is what useLayoutEffect guarantees on first
  // paint). Recompute on viewport resize too — the user can resize
  // the window with the dialog open.
  // Measurement-based initial zoom: we need the SVG mounted in the DOM
  // before we can read its bounding box, so this runs in a layout
  // effect. The `set-state-in-effect` rule flags synchronous setState
  // inside an effect on principle, but post-mount measurement is
  // exactly the rule's documented escape hatch (`useLayoutEffect`
  // synchronously paints with the new state, so there's no flash).
  useLayoutEffect(() => {
    const fit = computeFitZoom();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoFit(fit);
    setZoom(fit);
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let previousFit = fit;
    const ro = new ResizeObserver(() => {
      const next = computeFitZoom();
      setAutoFit(next);
      // Don't yank the user's manual zoom out from under them — only
      // re-fit if they're still at the previously computed fit.
      setZoom((cur) =>
        Math.abs(cur - previousFit) < 0.001 ? next : cur,
      );
      previousFit = next;
    });
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [computeFitZoom]);

  const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const zoomBy = useCallback((factor: number) => {
    setZoom((cur) => clamp(cur * factor));
  }, []);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const reset = useCallback(() => setZoom(1), []);
  const fit = useCallback(() => {
    const next = computeFitZoom();
    setAutoFit(next);
    setZoom(next);
  }, [computeFitZoom]);

  // Ctrl / Cmd + wheel = zoom toward the cursor. Plain wheel keeps
  // the default behaviour (scroll the viewport), which is what users
  // expect inside a scrollable preview.
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      // Cursor position within the *scrollable* content (pre-zoom).
      const cursorX = e.clientX - rect.left + viewport.scrollLeft;
      const cursorY = e.clientY - rect.top + viewport.scrollTop;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((cur) => {
        const next = clamp(cur * factor);
        if (next === cur) return cur;
        // Keep the point under the cursor stable: scroll so that the
        // same content-space point lands at the same screen offset.
        requestAnimationFrame(() => {
          const vp = viewportRef.current;
          if (!vp) return;
          const ratio = next / cur;
          vp.scrollLeft = cursorX * ratio - (e.clientX - rect.left);
          vp.scrollTop = cursorY * ratio - (e.clientY - rect.top);
        });
        return next;
      });
    },
    [],
  );

  // Drag-to-pan. We use pointer events + capture so the drag keeps
  // working even if the cursor leaves the viewport during a fast move.
  const panState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Left-button only; ignore clicks on the toolbar (it's outside
    // this element anyway, but be defensive).
    if (e.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    panState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(e.pointerId);
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const s = panState.current;
    const viewport = viewportRef.current;
    if (!s || !viewport || s.pointerId !== e.pointerId) return;
    viewport.scrollLeft = s.scrollLeft - (e.clientX - s.startX);
    viewport.scrollTop = s.scrollTop - (e.clientY - s.startY);
  }, []);

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const s = panState.current;
    const viewport = viewportRef.current;
    if (!s || !viewport || s.pointerId !== e.pointerId) return;
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be lost (e.g. dialog close); ignore.
    }
    panState.current = null;
    setIsPanning(false);
  }, []);

  // Keyboard shortcuts: +, -, 0 (reset), f (fit). Bound to window so
  // they work without the user clicking inside the viewport first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fight with typing in inputs — but there are none inside
      // this dialog. Still, guard against it for future safety.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, reset, fit]);

  const percent = Math.round(zoom * 100);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {/*
          Inner wrapper sized 100%/100% with flex centering so small
          diagrams sit in the middle of the dialog. The transform is
          applied to the SVG container; we override the previous
          "fit-to-container" CSS so the SVG renders at natural size.
        */}
        <div className="flex h-full w-full min-h-full min-w-full items-center justify-center p-6">
          <div
            ref={contentRef}
            // Hide the SVG until we've measured & set the fit zoom,
            // otherwise the first paint flashes a full-size diagram.
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 80ms ease-out",
              opacity: autoFit === null ? 0 : 1,
            }}
            className="[&_svg]:h-auto [&_svg]:w-auto [&_svg]:max-h-none [&_svg]:max-w-none select-none"
            // mermaid produces trusted SVG (securityLevel: 'loose' but
            // it sanitises user-supplied source). Same trust boundary
            // as the on-canvas card.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
      <ZoomToolbar
        percent={percent}
        canZoomOut={zoom > MIN_ZOOM + 0.001}
        canZoomIn={zoom < MAX_ZOOM - 0.001}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={reset}
        onFit={fit}
      />
    </div>
  );
}

function ZoomToolbar({
  percent,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
}: {
  percent: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  return (
    <div
      // Bottom-centred floating toolbar. Sits over the SVG without
      // stealing pointer events away from drag-pan everywhere else.
      className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-1 py-1 shadow-lg backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
          onClick={onZoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out"
          title="Zoom out  (−)"
        >
          <Minus className="size-4" />
        </Button>
        <button
          type="button"
          // Click the percent to reset to 100%. Same as Figma /
          // Excalidraw's zoom widget — feels natural.
          onClick={onReset}
          aria-label="Reset zoom to 100%"
          title="Reset zoom  (0)"
          className="min-w-[3.25rem] rounded-md px-2 py-1 text-center text-xs tabular-nums text-zinc-200 hover:bg-zinc-800"
        >
          {percent}%
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
          onClick={onZoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in"
          title="Zoom in  (+)"
        >
          <Plus className="size-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={onFit}
          aria-label="Fit diagram to view"
          title="Fit to view  (F)"
        >
          <Maximize2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={onReset}
          aria-label="Reset zoom to 100%"
          title="Reset to 100%  (0)"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </div>
  );
}
