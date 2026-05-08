"use client";

import { useEffect, useMemo, useState } from "react";

import { useDesignCanvas } from "./canvas-store";
import type { DesignNode } from "./design-node";
import type { Artboard } from "./types";

/**
 * Prototype-arrow overlay. When flow-view is enabled, walks every
 * artboard's tree, finds every button/link with a `flowTo` field, and
 * draws an SVG arrow from the source DOM node's center to the target
 * artboard's top-left.
 *
 * Lives **inside** the transformed world div in `<CanvasViewport>` so
 * it inherits the camera transform — every coordinate computed below
 * is in world space.
 *
 * Source positions need a layout measurement (the rendered button's
 * size and offset depend on the design tree); we re-measure on every
 * effect run keyed on flow-list changes, artboard movements, and the
 * camera (since `getBoundingClientRect` returns screen coords that
 * have to be back-projected to world).
 */
interface FlowEdge {
  /** Stable key: `<sourceArtboardId>:<sourceNodeId>`. */
  id: string;
  sourceArtboardId: string;
  sourceNodeId: string;
  toArtboardId: string;
}

interface ResolvedEdge extends FlowEdge {
  /** World-space source point (button center). */
  sx: number;
  sy: number;
  /** World-space target point (target artboard top-left). */
  tx: number;
  ty: number;
  /** True when the target artboard couldn't be found (deleted /
   *  cross-design) — we'd rather show a dimmed arrow than silently
   *  drop the edge. */
  targetMissing?: boolean;
}

export function FlowOverlay() {
  const flowViewEnabled = useDesignCanvas((s) => s.flowViewEnabled);
  const artboards = useDesignCanvas((s) => s.artboards);
  const camera = useDesignCanvas((s) => s.camera);

  // Collect every flowTo edge across all artboards. Memoised on the
  // identity of the artboards array — the canvas store always
  // produces a new array reference when something changed, so the
  // memo only runs when the trees actually move.
  const edges = useMemo<FlowEdge[]>(() => {
    const out: FlowEdge[] = [];
    for (const ab of artboards) {
      if (!ab.design) continue;
      collectFlowEdges(ab.design, ab.id, out);
    }
    return out;
  }, [artboards]);

  const [resolved, setResolved] = useState<ResolvedEdge[]>([]);

  // Measure source rects whenever:
  //  - the edge list changes (flowTo added/removed)
  //  - any artboard moves (the source's world position changes)
  //  - the camera zoom changes (screen→world projection scale)
  //
  // This is the textbook case for setState-in-effect: we're
  // synchronizing React state with measurements of an external system
  // (the live DOM layout). There is no other way to read post-layout
  // box dimensions and reflect them in JSX. The functional setter
  // returns `prev` when nothing changed so cascades are avoided.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved((prev) => {
      if (!flowViewEnabled || edges.length === 0) {
        return prev.length === 0 ? prev : [];
      }
      const next: ResolvedEdge[] = [];
      for (const edge of edges) {
        const sourceArtboard = artboards.find(
          (a) => a.id === edge.sourceArtboardId,
        );
        const targetArtboard = artboards.find(
          (a) => a.id === edge.toArtboardId,
        );
        if (!sourceArtboard) continue;

        // Source point: world coords of the rendered DOM node's
        // center, computed relative to the artboard's frame so we
        // skip a camera matrix.
        const dom = document.querySelector<HTMLElement>(
          `[data-artboard-frame-id="${edge.sourceArtboardId}"] [data-node-id="${edge.sourceNodeId}"]`,
        );
        if (!dom) continue;
        const frame = document.querySelector<HTMLElement>(
          `[data-artboard-frame-id="${edge.sourceArtboardId}"]`,
        );
        if (!frame) continue;

        const nodeRect = dom.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        // (nodeCenter - frameTopLeft) is in screen pixels; divide by
        // zoom to get world-space offset within the frame.
        const localX =
          (nodeRect.left + nodeRect.width / 2 - frameRect.left) / camera.zoom;
        const localY =
          (nodeRect.top + nodeRect.height / 2 - frameRect.top) / camera.zoom;

        const sx = sourceArtboard.x + localX;
        const sy = sourceArtboard.y + localY;

        const targetMissing = !targetArtboard;
        const tx = targetArtboard ? targetArtboard.x : sx + 200;
        const ty = targetArtboard ? targetArtboard.y : sy;

        next.push({ ...edge, sx, sy, tx, ty, targetMissing });
      }
      return resolvedEqual(prev, next) ? prev : next;
    });
  }, [flowViewEnabled, edges, artboards, camera.zoom]);

  if (!flowViewEnabled || resolved.length === 0) return null;

  // The SVG fills the world coordinate range we need. Computing its
  // bounds once spares us from needing absolute-positioned arrows.
  const bounds = svgBounds(resolved);

  return (
    <svg
      // pointer-events: none so arrows don't intercept clicks on the
      // artboards beneath. Inside the world transform; coordinates
      // are world-space.
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        pointerEvents: "none",
      }}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
    >
      <defs>
        <marker
          id="flow-arrow-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
        </marker>
        <marker
          id="flow-arrow-head-dim"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#fb7185" />
        </marker>
      </defs>
      {resolved.map((e) => (
        <FlowArrow key={e.id} edge={e} />
      ))}
    </svg>
  );
}

/**
 * One bezier arrow from `(sx, sy)` to `(tx, ty)`. The control points
 * push the curve out horizontally so it reads as a flow connector
 * rather than a straight line — same idiom Figma uses.
 *
 * Stroke is scaled so it stays roughly 2 CSS pixels wide regardless
 * of camera zoom.
 */
function FlowArrow({ edge }: { edge: ResolvedEdge }) {
  const camera = useDesignCanvas((s) => s.camera);
  // Counteract the world transform's zoom so strokes stay 2px on
  // screen no matter how far you zoom out.
  const stroke = 2 / camera.zoom;
  const dx = edge.tx - edge.sx;
  const offset = Math.max(60, Math.abs(dx) * 0.4);
  const c1x = edge.sx + offset;
  const c1y = edge.sy;
  const c2x = edge.tx - offset;
  const c2y = edge.ty;
  const path = `M ${edge.sx} ${edge.sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${edge.tx} ${edge.ty}`;

  const color = edge.targetMissing ? "#fb7185" : "#3b82f6";
  const markerId = edge.targetMissing
    ? "flow-arrow-head-dim"
    : "flow-arrow-head";

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeOpacity={0.9}
        markerEnd={`url(#${markerId})`}
      />
      {/* Source dot for clarity. */}
      <circle
        cx={edge.sx}
        cy={edge.sy}
        r={stroke * 2.5}
        fill={color}
      />
    </g>
  );
}

/* ─── helpers ──────────────────────────────────────────── */

/**
 * Recursively walk a design tree, pushing each (button|link).flowTo
 * edge onto `out`. Each edge's `id` is `<sourceArtboardId>:<nodeId>`
 * so React keys are stable across renders.
 */
function collectFlowEdges(
  node: DesignNode,
  artboardId: string,
  out: FlowEdge[],
) {
  if ((node.type === "button" || node.type === "link") && node.flowTo && node.id) {
    out.push({
      id: `${artboardId}:${node.id}`,
      sourceArtboardId: artboardId,
      sourceNodeId: node.id,
      toArtboardId: node.flowTo.artboardId,
    });
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectFlowEdges(child, artboardId, out);
    }
  }
}

/**
 * Compute a bounding box that covers every edge's source and target,
 * with a comfortable padding so curve overshoots aren't clipped.
 *
 * Returned in world coords; the SVG element is positioned at
 * `(bounds.x, bounds.y)` and uses `viewBox="bounds.x bounds.y w h"`
 * so SVG coords match world coords 1:1.
 */
function svgBounds(edges: ResolvedEdge[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of edges) {
    xs.push(e.sx, e.tx);
    ys.push(e.sy, e.ty);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const padding = 200;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Cheap shallow equality on resolved edge lists. Same length + every
 * (id, source xy, target xy, missing flag) match. Lets the
 * measurement effect early-out when nothing visible changed (zoom by
 * a hair, idle re-render, etc.) so React skips the re-paint.
 */
function resolvedEqual(a: ResolvedEdge[], b: ResolvedEdge[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.sx !== y.sx ||
      x.sy !== y.sy ||
      x.tx !== y.tx ||
      x.ty !== y.ty ||
      x.targetMissing !== y.targetMissing
    ) {
      return false;
    }
  }
  return true;
}

/** Re-export the artboard type so callers don't have to chase imports
 *  across files when wiring the toolbar later. */
export type FlowOverlayArtboard = Artboard;
