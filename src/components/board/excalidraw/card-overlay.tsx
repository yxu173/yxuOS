"use client";

/**
 * Renders markdown / mermaid "card" overlays on top of the Excalidraw
 * canvas.
 *
 * Excalidraw doesn't expose tldraw-style custom shapes — there's no
 * `BaseBoxShapeUtil` to subclass. The workaround is the classic
 * "HTML overlay positioned in canvas space" trick:
 *
 *   1. Cards are persisted as **regular Excalidraw rectangles** with
 *      a `customData` discriminator: `{ kind: "markdown-card", markdown }`
 *      or `{ kind: "mermaid-card", mermaid, mermaidKind }`. They size,
 *      move, resize, and bind arrows like any other shape.
 *
 *   2. This component reads the live elements + appState from the
 *      Excalidraw imperative API, finds the cards, computes their
 *      viewport-space bounding boxes via `sceneCoordsToViewportCoords`,
 *      and renders HTML overlays at those positions. Zoom is applied
 *      to width/height so the cards scale with the canvas.
 *
 *   3. The overlay is `pointer-events: none` so it never steals
 *      clicks from Excalidraw — you can still select, drag, resize
 *      the underlying rectangle. The "Preview" button on top of a
 *      selected card flips `pointer-events: auto` so it's clickable.
 *
 * On the loaded canvas the underlying rectangle's stroke is invisible
 * (we set `strokeColor` to `transparent` and `backgroundColor` to
 * `transparent` when an agent creates a card — see Phase 2). On
 * existing manually-created rectangles, this component renders nothing.
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { ExpandIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { MarkdownProse } from "@/components/markdown/markdown-prose";

import { renderMermaid } from "../mermaid";
import {
  ShapePreviewDialog,
  type ShapePreviewKind,
} from "../shape-preview-dialog";

/** customData discriminator stamped on card rectangles. */
export type CardCustomData =
  | { kind: "markdown-card"; markdown: string }
  | { kind: "mermaid-card"; mermaid: string; mermaidKind: string };

type CardElement = NonDeletedExcalidrawElement & {
  customData: CardCustomData;
};

function readCardData(el: ExcalidrawElement): CardCustomData | null {
  const data = el.customData;
  if (!data || typeof data !== "object") return null;
  const kind = (data as { kind?: unknown }).kind;
  if (kind === "markdown-card" && typeof data.markdown === "string") {
    return { kind: "markdown-card", markdown: data.markdown };
  }
  if (
    kind === "mermaid-card" &&
    typeof data.mermaid === "string" &&
    typeof data.mermaidKind === "string"
  ) {
    return {
      kind: "mermaid-card",
      mermaid: data.mermaid,
      mermaidKind: data.mermaidKind,
    };
  }
  return null;
}

export function ExcalidrawCardOverlay({
  api,
}: {
  api: ExcalidrawImperativeAPI;
}) {
  // We track the live scene via a tiny rerender ticker. `api.onChange`
  // fires on every input event — element edits, camera moves, selection
  // changes — which is exactly the cadence we need for the overlay to
  // stay glued to its underlying rectangle. We don't store the elements
  // in state to avoid stale-render churn; we just read fresh values
  // off the API on each render and bump a counter to force one.
  const [, force] = useState(0);
  useEffect(() => {
    // The first render of this component already reads the live scene
    // via `api.getSceneElements()` / `api.getAppState()` below — no
    // synchronous initial bump needed. From here on, Excalidraw's
    // `onChange` ticks every input event (element edits, camera
    // moves, selection) which is exactly the cadence we need to
    // keep the overlay glued to its underlying rectangle.
    return api.onChange(() => {
      force((n) => n + 1);
    });
  }, [api]);

  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const cards: CardElement[] = [];
  for (const el of elements) {
    if (el.type !== "rectangle") continue;
    const data = readCardData(el);
    if (!data) continue;
    cards.push({ ...el, customData: data } as CardElement);
  }

  const [preview, setPreview] = useState<ShapePreviewKind | null>(null);

  return (
    <>
      {/*
        The overlay layer is absolutely-positioned over the same DOM
        rect as the Excalidraw canvas. `pointer-events: none` keeps
        Excalidraw's input handling intact — children opt back in
        individually (e.g. the Preview button).

        z-index 3 sits between the interactive canvas (--zIndex-
        interactiveCanvas = 2) and the toolbars/library panel (--zIndex-
        layerUI = 4). Without this we tie at z-index 0 with the
        Excalidraw root and the static canvas (z-index 1) paints
        over the overlay, so cards render as just their underlying
        rectangle outline with no visible body — see the diagnosis
        comment in `executeAddMarkdownCard`. Tying with --zIndex-
        wysiwyg/svgLayer (3) is fine: same z, DOM order breaks the
        tie in our favour because the overlay is rendered AFTER the
        `<Excalidraw>` sibling in `excalidraw-canvas.tsx`.
      */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 3 }}
      >
        {cards.map((card) => (
          <CardSlot
            key={card.id}
            card={card}
            appState={appState}
            onPreview={() => {
              if (card.customData.kind === "markdown-card") {
                setPreview({
                  type: "markdown",
                  markdown: card.customData.markdown,
                });
              } else {
                setPreview({
                  type: "mermaid",
                  mermaid: card.customData.mermaid,
                  shapeId: card.id,
                });
              }
            }}
          />
        ))}
      </div>
      <ShapePreviewDialog
        preview={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </>
  );
}

function CardSlot({
  card,
  appState,
  onPreview,
}: {
  card: CardElement;
  appState: AppState;
  onPreview: () => void;
}) {
  // Element x/y/width/height live in scene (canvas) space. Excalidraw
  // converts to viewport coords by adding `offsetLeft / offsetTop`
  // (the page-relative position of the canvas container). Our
  // overlay div is `absolute inset-0` inside the SAME container, so
  // it's container-relative — we have to subtract the offsets back
  // out or every card lands wherever the canvas would be if it lived
  // at (0, 0) of the page, i.e. way off to the left under the side
  // panels.
  const viewport = sceneCoordsToViewportCoords(
    { sceneX: card.x, sceneY: card.y },
    appState,
  );
  const left = viewport.x - appState.offsetLeft;
  const top = viewport.y - appState.offsetTop;
  const zoom = appState.zoom.value;
  const widthPx = card.width * zoom;
  const heightPx = card.height * zoom;

  // Don't bother rendering the body at sub-pixel readability —
  // < ~3 px text is unreadable anyway and the user can open the full
  // dialog via the always-visible Open button.
  const showBody = zoom >= 0.25;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: widthPx,
          height: heightPx,
          borderRadius: 12 * zoom,
          border: "1px solid color-mix(in oklch, white 12%, transparent)",
          background: "color-mix(in oklch, black 65%, transparent)",
          backdropFilter: "blur(12px)",
          overflow: "hidden",
          color: "var(--foreground, #f5f5f5)",
          // Display-only — clicks fall through to the underlying
          // rectangle so Excalidraw handles select/drag/resize. The
          // Open button below opts back in to pointer events.
          pointerEvents: "none",
        }}
      >
        {showBody ? (
          <CardBody data={card.customData} card={card} zoom={zoom} />
        ) : null}
      </div>
      {/*
        Always-visible Open button in the top-right of every card.
        The on-canvas card is clipped to whatever box the agent drew;
        long markdown notes will inevitably overflow. Clicking Open
        renders the full content in a 90vw × 85vh dialog — see
        `ShapePreviewDialog`. Visibility is independent of selection
        so users don't have to discover "click the card first".
      */}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        className="pointer-events-auto absolute z-10 inline-flex items-center gap-1 rounded-md border border-white/10 bg-zinc-900/70 px-1.5 py-1 text-[11px] font-medium text-zinc-200 shadow-sm backdrop-blur-sm transition hover:border-white/25 hover:bg-zinc-800/90 hover:text-white"
        style={{
          left: left + widthPx - 8 - 56,
          top: top + 8,
        }}
        aria-label="Open card preview"
      >
        <ExpandIcon className="size-3" aria-hidden />
        Open
      </button>
    </>
  );
}

function CardBody({
  data,
  card,
  zoom,
}: {
  data: CardCustomData;
  card: CardElement;
  zoom: number;
}): ReactNode {
  /*
   * Strategy: render the body at scene-space dimensions (i.e.
   * `card.width / card.height` CSS px) inside a transform: scale(zoom)
   * wrapper. That lets us reuse the full `MarkdownProse` typography
   * (which uses rem-based Tailwind classes) without recalculating
   * every font-size on the zoom axis, and it scales pixel-perfectly
   * with the canvas.
   *
   * The outer `<div style={{overflow: hidden}}>` on `CardSlot`
   * clips the scaled content to the card's viewport-pixel rect, so
   * long markdown overflows are visibly truncated — the user reaches
   * for the Open button (top-right of every card) to see the rest.
   */
  const innerWidth = card.width;
  const innerHeight = card.height;
  const wrapper: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: innerWidth,
    height: innerHeight,
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
    overflow: "hidden",
    padding: "14px 16px",
  };

  if (data.kind === "markdown-card") {
    return (
      <div style={wrapper}>
        <MarkdownProse>{data.markdown}</MarkdownProse>
      </div>
    );
  }
  return (
    <div style={wrapper}>
      <MermaidCardBody
        cardId={card.id}
        source={data.mermaid}
        kind={data.mermaidKind}
      />
    </div>
  );
}

/**
 * Renders mermaid source to inline SVG, scaled to fit the card.
 *
 * - Re-runs only when `cardId` or `source` changes; the overlay
 *   re-renders on every Excalidraw `onChange` (input events, camera
 *   moves, selection) but `useState` survives those renders so we
 *   don't pay the ~600 KB mermaid bundle cost or the parse +
 *   render cost on every tick.
 *
 * - SVG sizing: mermaid produces SVG with intrinsic dimensions
 *   matching the diagram. We constrain it to fit the card via
 *   `max-width/height: 100%` and center it with flex.
 *
 * - The `<style>` injected by mermaid is scoped via the generated
 *   id, so two cards with different sources won't fight over CSS.
 */
function MermaidCardBody({
  cardId,
  source,
  kind,
}: {
  cardId: string;
  source: string;
  kind: string;
}) {
  // Result is tagged with the `source` it came from. While a new
  // source is being rendered, the previous SVG is considered "stale"
  // and we show the loading state — without having to call setState
  // synchronously inside the effect (which React 19's exhaustive-deps
  // rule rightly flags).
  const [result, setResult] = useState<
    | { status: "ok"; svg: string; source: string }
    | { status: "err"; message: string; source: string }
    | null
  >(null);
  const isStale = result === null || result.source !== source;

  useEffect(() => {
    let cancelled = false;
    // Distinct render id from the dialog's preview SVG so mermaid
    // doesn't try to reuse a cached DOM node sized for a different
    // container.
    const safeId = `mermaid-card-${cardId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    renderMermaid(safeId, source)
      .then((svg) => {
        if (!cancelled) setResult({ status: "ok", svg, source });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          status: "err",
          message: err instanceof Error ? err.message : "Render failed",
          source,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, source]);

  if (isStale) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#a3a3a3",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        Rendering {kind}…
      </div>
    );
  }

  if (result?.status === "err") {
    // On a parse error we still want to show the source so the user
    // can see what went wrong without opening the dialog.
    return (
      <div
        style={{
          height: "100%",
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          color: "#f87171",
        }}
      >
        <strong>Mermaid error</strong>
        <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
          {result.message}
        </pre>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
      className="[&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:w-auto"
      // Mermaid SVG is trusted output — same trust boundary as the
      // preview dialog. The source is validated server-side in
      // `executeAddMermaidCard` before the card is created.
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
