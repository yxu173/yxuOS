"use client";

/**
 * Excalidraw counterparts of the canvas tools defined in
 * `../canvas-tools.ts`. Same exported names + return shapes — the
 * dispatcher just picks the right module based on which engine is
 * mounted. Every mutating function:
 *
 *   - reads the live element array via `api.getSceneElements()`
 *   - builds a new element list (mutation = pass the full array
 *     back, Excalidraw doesn't have a per-element update API)
 *   - calls `api.updateScene({ elements: ..., captureUpdate: IMMEDIATELY })`
 *     so the change lands in the undo stack like any user action
 *
 * Why `convertToExcalidrawElements`? Excalidraw elements have ~30
 * required fields each (versions, seeds, indices, fractional indices,
 * bound-element back-pointers, …). The transform helper accepts a
 * compact "skeleton" and fills the rest. Using it keeps this file
 * focused on translating *intent* — "make a rectangle with this label
 * at this position" — and leaves bookkeeping to Excalidraw.
 */

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

import {
  fail,
  ok,
  withIdempotency,
  withIdempotencyAsync,
  type ToolResult,
} from "@/lib/tool-result";

import { validateMermaid } from "../mermaid";

/* ─── shared types ────────────────────────────────────── */

interface PointInput {
  x: number;
  y: number;
}

interface ShapeRefInput {
  shapeId: string;
}

interface ShapeInput {
  type: "geo" | "arrow" | "text" | "note" | "frame";
  x?: number;
  y?: number;
  geo?: string;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  fill?: string;
  size?: string;
  start?: PointInput | ShapeRefInput;
  end?: PointInput | ShapeRefInput;
}

export interface ShapeRow {
  id: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
}

export interface QueryCanvasOutput {
  summary: {
    totalShapes: number;
    byType: Record<string, number>;
    sampleLabels: string[];
  };
  shapes?: ShapeRow[];
  returned: number;
  truncated: boolean;
  nextCursor: string | null;
  camera: { x: number; y: number; z: number };
  viewport: { x: number; y: number; w: number; h: number };
  selectedShapeIds: string[];
}

export interface QueryCanvasInput {
  summaryOnly?: boolean;
  viewportOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface FindShapesInput {
  query?: string;
  type?: string;
  viewportOnly?: boolean;
  limit?: number;
}

export interface FindShapesOutput {
  matches: ShapeRow[];
  totalMatched: number;
  truncated: boolean;
}

/* ─── colour / size / fill mapping ─────────────────────── *
 *
 * The agent schemas use a small colour vocabulary
 * ("blue"/"red"/"green"/…) that the system prompt taught it to
 * speak. Translate those to Excalidraw's stroke / background
 * palette so the agent doesn't need to know
 * which engine is mounted.
 *
 * Sticky notes use the yellow background only — drawn as a rectangle
 * with `backgroundColor` set and `customData.kind === "note"` so
 * `find_shapes type=note` works.
 */

const STROKE_BY_COLOR: Record<string, string> = {
  black: "#1e1e1e",
  grey: "#5c5c5c",
  blue: "#1971c2",
  green: "#2f9e44",
  red: "#e03131",
  violet: "#9c36b5",
  orange: "#e8590c",
  yellow: "#f08c00",
  "light-blue": "#4dabf7",
  "light-green": "#69db7c",
  "light-red": "#ff8787",
  "light-violet": "#da77f2",
};

const BG_BY_COLOR: Record<string, string> = {
  black: "#e6e6e6",
  grey: "#dee2e6",
  blue: "#a5d8ff",
  green: "#b2f2bb",
  red: "#ffc9c9",
  violet: "#e0bbf9",
  orange: "#ffd8a8",
  yellow: "#ffe066",
  "light-blue": "#d0ebff",
  "light-green": "#c3fae8",
  "light-red": "#ffe3e3",
  "light-violet": "#f3d9fa",
};

const STROKE_WIDTH_BY_SIZE: Record<string, number> = {
  s: 1,
  m: 2,
  l: 4,
  xl: 6,
};

// Excalidraw font sizes used for labels inside geo shapes / on arrows.
const FONT_SIZE_BY_SIZE: Record<string, number> = {
  s: 16,
  m: 20,
  l: 28,
  xl: 36,
};

type ExcalidrawFillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";

function mapFillStyle(fill: string | undefined): ExcalidrawFillStyle {
  switch (fill) {
    case "solid":
      return "solid";
    case "semi":
      return "hachure";
    case "pattern":
      return "cross-hatch";
    default:
      return "hachure";
  }
}

function mapStroke(color: string | undefined): string {
  return STROKE_BY_COLOR[color ?? "black"] ?? STROKE_BY_COLOR.black!;
}

function mapBackground(
  color: string | undefined,
  fill: string | undefined,
): string {
  if (!fill || fill === "none") return "transparent";
  return BG_BY_COLOR[color ?? "black"] ?? BG_BY_COLOR.black!;
}

function mapStrokeWidth(size: string | undefined): number {
  return STROKE_WIDTH_BY_SIZE[size ?? "m"] ?? STROKE_WIDTH_BY_SIZE.m!;
}

function mapFontSize(size: string | undefined): number {
  return FONT_SIZE_BY_SIZE[size ?? "m"] ?? FONT_SIZE_BY_SIZE.m!;
}

// Map the agent's `geo` enum onto Excalidraw's native shape types.
// The agent schema only emits {rectangle, ellipse, diamond} but we
// accept legacy values (cloud, star, hexagon, …) so old saved
// prompts and chat replays don't blow up.
function mapGeoType(
  geo: string | undefined,
): "rectangle" | "ellipse" | "diamond" {
  switch (geo) {
    case "ellipse":
    case "oval":
      return "ellipse";
    case "diamond":
    case "rhombus":
      return "diamond";
    default:
      // rectangle, triangle, trapezoid, hexagon, octagon, star,
      // cloud, x-box, check-box → fall through to rectangle. Lossy
      // for legacy prompts but lossless going forward.
      return "rectangle";
  }
}

/* ─── helpers ─────────────────────────────────────────── */

const TEXT_PREVIEW_LIMIT = 200;
const SAMPLE_LABEL_LIMIT = 10;
const SAMPLE_LABEL_TEXT_LIMIT = 60;
const QUERY_DEFAULT_LIMIT = 100;
const FIND_DEFAULT_LIMIT = 20;
const ARROW_FALLBACK_LENGTH = 200;

function truncate(value: string | undefined, limit = TEXT_PREVIEW_LIMIT) {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Pull the friendliest text label off an element. */
function getElementText(
  el: NonDeletedExcalidrawElement,
  elementsById: Map<string, NonDeletedExcalidrawElement>,
): string | undefined {
  // Markdown / mermaid cards carry their content in customData.
  const cd = el.customData;
  if (cd && typeof cd === "object") {
    if (typeof cd.markdown === "string") return truncate(cd.markdown);
    if (typeof cd.mermaid === "string") return truncate(cd.mermaid);
  }
  if (el.type === "text" && el.text.trim()) return truncate(el.text);
  if (el.type === "frame" && el.name?.trim()) return truncate(el.name);
  // Container shapes (rectangle/ellipse/diamond/arrow) carry their
  // visible label as a separate text element bound via
  // `boundElements` / `containerId`.
  const labelRef = el.boundElements?.find((b) => b.type === "text");
  if (labelRef) {
    const label = elementsById.get(labelRef.id);
    if (label && label.type === "text" && label.text.trim()) {
      return truncate(label.text);
    }
  }
  return undefined;
}

/** Map an element to the "shape row" we expose to the agent. */
function elementToRow(
  el: NonDeletedExcalidrawElement,
  elementsById: Map<string, NonDeletedExcalidrawElement>,
): ShapeRow {
  const type = inferAgentType(el);
  return {
    id: el.id,
    type,
    x: el.x,
    y: el.y,
    w: el.width,
    h: el.height,
    text: getElementText(el, elementsById),
  };
}

/**
 * Translate an Excalidraw element type back to the agent's vocabulary
 * so it can pattern-match on the same strings it emits in `add_shapes`.
 */
function inferAgentType(el: NonDeletedExcalidrawElement): string {
  const cd = el.customData;
  if (cd && typeof cd === "object" && typeof cd.kind === "string") {
    if (cd.kind === "markdown-card") return "markdown-card";
    if (cd.kind === "mermaid-card") return "mermaid-card";
    if (cd.kind === "note") return "note";
  }
  switch (el.type) {
    case "text":
      return "text";
    case "arrow":
      return "arrow";
    case "frame":
    case "magicframe":
      return "frame";
    case "rectangle":
    case "ellipse":
    case "diamond":
      return "geo";
    default:
      return el.type;
  }
}

/** Viewport in scene coordinates, derived from the live appState. */
function viewportSceneBounds(state: AppState): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const zoom = state.zoom.value || 1;
  const minX = -state.scrollX;
  const minY = -state.scrollY;
  const maxX = minX + (state.width ?? 0) / zoom;
  const maxY = minY + (state.height ?? 0) / zoom;
  return { minX, minY, maxX, maxY };
}

function intersectsViewport(
  el: NonDeletedExcalidrawElement,
  state: AppState,
): boolean {
  const vp = viewportSceneBounds(state);
  const elMaxX = el.x + el.width;
  const elMaxY = el.y + el.height;
  return !(
    elMaxX < vp.minX ||
    el.x > vp.maxX ||
    elMaxY < vp.minY ||
    el.y > vp.maxY
  );
}

function buildSummary(
  elements: readonly NonDeletedExcalidrawElement[],
  elementsById: Map<string, NonDeletedExcalidrawElement>,
): QueryCanvasOutput["summary"] {
  const byType: Record<string, number> = {};
  const sampleLabels: string[] = [];
  for (const el of elements) {
    const type = inferAgentType(el);
    byType[type] = (byType[type] ?? 0) + 1;
    if (sampleLabels.length < SAMPLE_LABEL_LIMIT) {
      const text = getElementText(el, elementsById);
      if (text) {
        sampleLabels.push(
          text.length > SAMPLE_LABEL_TEXT_LIMIT
            ? `${text.slice(0, SAMPLE_LABEL_TEXT_LIMIT)}…`
            : text,
        );
      }
    }
  }
  return { totalShapes: elements.length, byType, sampleLabels };
}

function makeElementsById(
  elements: readonly NonDeletedExcalidrawElement[],
): Map<string, NonDeletedExcalidrawElement> {
  const m = new Map<string, NonDeletedExcalidrawElement>();
  for (const el of elements) m.set(el.id, el);
  return m;
}

function parseCursor(cursor: string): number {
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeCursor(index: number): string {
  return String(index);
}

function isShapeRef(value: unknown): value is ShapeRefInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "shapeId" in value &&
    typeof (value as ShapeRefInput).shapeId === "string"
  );
}

/* ─── query_canvas ─────────────────────────────────────── */

export function executeQueryCanvas(
  api: ExcalidrawImperativeAPI,
  input: QueryCanvasInput = {},
): ToolResult<QueryCanvasOutput> {
  try {
    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const summary = buildSummary(elements, elementsById);

    const appState = api.getAppState();
    const zoom = appState.zoom.value || 1;
    const camera = {
      x: -appState.scrollX,
      y: -appState.scrollY,
      z: zoom,
    };
    const vp = viewportSceneBounds(appState);
    const viewport = {
      x: vp.minX,
      y: vp.minY,
      w: vp.maxX - vp.minX,
      h: vp.maxY - vp.minY,
    };
    const selectedShapeIds = Object.keys(appState.selectedElementIds ?? {});

    if (input.summaryOnly) {
      return ok({
        summary,
        returned: 0,
        truncated: false,
        nextCursor: null,
        camera,
        viewport,
        selectedShapeIds,
      });
    }

    const filtered = input.viewportOnly
      ? elements.filter((el) => intersectsViewport(el, appState))
      : elements;

    const limit = input.limit ?? QUERY_DEFAULT_LIMIT;
    const start = input.cursor ? parseCursor(input.cursor) : 0;
    const slice = filtered.slice(start, start + limit);
    const truncated = start + slice.length < filtered.length;

    return ok({
      summary,
      shapes: slice.map((el) => elementToRow(el, elementsById)),
      returned: slice.length,
      truncated,
      nextCursor: truncated ? encodeCursor(start + slice.length) : null,
      camera,
      viewport,
      selectedShapeIds,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "query_canvas failed",
    );
  }
}

/* ─── find_shapes ──────────────────────────────────────── */

export function executeFindShapes(
  api: ExcalidrawImperativeAPI,
  input: FindShapesInput,
): ToolResult<FindShapesOutput> {
  try {
    const limit = input.limit ?? FIND_DEFAULT_LIMIT;
    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const appState = api.getAppState();
    const lowered = input.query?.toLowerCase();

    const allMatches: NonDeletedExcalidrawElement[] = [];
    for (const el of elements) {
      if (input.type && inferAgentType(el) !== input.type) continue;
      if (input.viewportOnly && !intersectsViewport(el, appState)) continue;
      if (lowered) {
        const text = getElementText(el, elementsById)?.toLowerCase();
        if (!text || !text.includes(lowered)) continue;
      }
      allMatches.push(el);
    }

    const truncated = allMatches.length > limit;
    const matches = allMatches
      .slice(0, limit)
      .map((el) => elementToRow(el, elementsById));

    return ok({
      matches,
      totalMatched: allMatches.length,
      truncated,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "find_shapes failed",
    );
  }
}

/* ─── arrow-binding helpers ────────────────────────────── *
 *
 * Excalidraw exposes two arrow-binding mechanisms and only one of
 * them is right for our case:
 *
 *   1. The `start: { id }` / `end: { id }` shortcut on a
 *      `convertToExcalidrawElements` skeleton. The helper resolves
 *      those ids **only within the skeleton array** — it has no
 *      view of the existing scene. Passing an id that lives on the
 *      canvas already throws "No element for start binding".
 *
 *   2. Explicit `startBinding` / `endBinding` on the arrow plus
 *      `boundElements` back-pointers on the targets. This works
 *      against any element regardless of when it was created.
 *
 * Our agent only ever references existing scene ids (per the system
 * prompt: build with `add_shapes`, then wire arrows via
 * `connect_shapes`). So mechanism 1 is unreachable for us and we
 * always do mechanism 2.
 *
 * `attachArrowBindings` patches an arrow built without bindings,
 * stitching `startBinding` / `endBinding` into it and pushing the
 * matching `{ type: "arrow", id }` entry into each target's
 * `boundElements`. Returns the new arrow plus a Map of patched
 * target elements so the caller can splice them into `updateScene`.
 */
const BINDING_DEFAULTS = { focus: 0 as const, gap: 1 as const };

function attachArrowBindings(
  arrow: OrderedExcalidrawElement,
  scene: readonly OrderedExcalidrawElement[],
  bindings: { startId?: string | null; endId?: string | null },
): {
  arrow: OrderedExcalidrawElement;
  patchedTargets: Map<string, OrderedExcalidrawElement>;
} {
  const patched = new Map<string, OrderedExcalidrawElement>();
  let nextArrow: OrderedExcalidrawElement = arrow;

  const stamp = (
    targetId: string | null | undefined,
    side: "startBinding" | "endBinding",
  ) => {
    if (!targetId) return;
    const target = scene.find((e) => e.id === targetId);
    if (!target) return;
    nextArrow = {
      ...nextArrow,
      [side]: { elementId: targetId, ...BINDING_DEFAULTS },
    } as OrderedExcalidrawElement;
    const current = patched.get(targetId) ?? target;
    const existing = (current as { boundElements?: readonly { id: string }[] })
      .boundElements;
    const already = existing?.some((b) => b.id === arrow.id);
    if (already) {
      patched.set(targetId, current);
      return;
    }
    patched.set(targetId, {
      ...current,
      boundElements: [
        ...(existing ?? []),
        { type: "arrow", id: arrow.id },
      ],
    } as OrderedExcalidrawElement);
  };

  stamp(bindings.startId ?? null, "startBinding");
  stamp(bindings.endId ?? null, "endBinding");

  return { arrow: nextArrow, patchedTargets: patched };
}

/* ─── reveal-on-create ───────────────────────────────── *
 *
 * Agent-placed content lives wherever the agent picked in scene
 * space. At the low zoom levels the user often drops boards to
 * (10–25 %) and with whatever scroll the camera happens to have,
 * a freshly-created shape is almost always outside the visible
 * viewport — so it looks like the tool did nothing.
 *
 * `revealNewElement` pans (and gently zooms in, capped at 100 %) so
 * the new element sits in view. It's a no-op if the element is
 * already comfortably inside the viewport — we don't want every
 * agent action to yank the camera around when the user can already
 * see the result.
 */
function revealNewElement(
  api: ExcalidrawImperativeAPI,
  element: OrderedExcalidrawElement,
): void {
  try {
    const appState = api.getAppState();
    const zoom = appState.zoom.value;
    const viewW = appState.width / zoom;
    const viewH = appState.height / zoom;
    // Visible scene rect (origin = top-left of viewport in scene coords).
    const visX = -appState.scrollX;
    const visY = -appState.scrollY;

    const fullyVisible =
      element.x >= visX &&
      element.y >= visY &&
      element.x + element.width <= visX + viewW &&
      element.y + element.height <= visY + viewH;

    if (fullyVisible && zoom >= 0.5) {
      // Already on-screen at a usable zoom — don't disturb the user.
      return;
    }

    api.scrollToContent(element, {
      fitToContent: true,
      animate: true,
      duration: 350,
      viewportZoomFactor: 0.9,
    });
  } catch {
    // scrollToContent is best-effort. A canvas race during unmount
    // shouldn't fail the tool call.
  }
}

/* ─── add_shapes ───────────────────────────────────────── */

/**
 * Resolve an arrow terminal (start/end) to the absolute scene point
 * + the optional bound shape id. The binding itself is attached
 * after `convertToExcalidrawElements` runs (see
 * `attachArrowBindings` above for why).
 */
function resolveTerminal(
  api: ExcalidrawImperativeAPI,
  terminal: PointInput | ShapeRefInput | undefined,
  fallback: PointInput,
): { point: PointInput; bindId: string | null } {
  if (!terminal) return { point: fallback, bindId: null };
  if (isShapeRef(terminal)) {
    const el = api
      .getSceneElements()
      .find((e) => e.id === terminal.shapeId);
    if (!el) return { point: fallback, bindId: null };
    return {
      point: { x: el.x + el.width / 2, y: el.y + el.height / 2 },
      bindId: el.id,
    };
  }
  return { point: { x: terminal.x, y: terminal.y }, bindId: null };
}

export function executeAddShapes(
  api: ExcalidrawImperativeAPI,
  input: { shapes: ShapeInput[]; idempotencyKey?: string },
): ToolResult<{ createdShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      // We build a single skeleton array and let
      // `convertToExcalidrawElements` give us back fully-fleshed
      // elements in one pass. That auto-wires the container ↔
      // bound-text link for labelled shapes. Arrow bindings are
      // explicit (see `attachArrowBindings`) because the helper's
      // `start: { id }` shortcut only resolves within the skeleton.
      const skeletons: Parameters<typeof convertToExcalidrawElements>[0] = [];
      const pendingArrowBindings: Array<{
        skeletonIndex: number;
        startId: string | null;
        endId: string | null;
      }> = [];

      for (const spec of input.shapes) {
        switch (spec.type) {
          case "geo": {
            const subtype = mapGeoType(spec.geo);
            skeletons.push({
              type: subtype,
              x: spec.x ?? 0,
              y: spec.y ?? 0,
              width: spec.w ?? 200,
              height: spec.h ?? 120,
              strokeColor: mapStroke(spec.color),
              backgroundColor: mapBackground(spec.color, spec.fill),
              fillStyle: mapFillStyle(spec.fill),
              strokeWidth: mapStrokeWidth(spec.size),
              ...(spec.text
                ? {
                    label: {
                      text: spec.text,
                      fontSize: mapFontSize(spec.size),
                    },
                  }
                : {}),
            });
            break;
          }
          case "text": {
            skeletons.push({
              type: "text",
              x: spec.x ?? 0,
              y: spec.y ?? 0,
              text: spec.text ?? "",
              strokeColor: mapStroke(spec.color),
              fontSize: mapFontSize(spec.size),
            });
            break;
          }
          case "note": {
            skeletons.push({
              type: "rectangle",
              x: spec.x ?? 0,
              y: spec.y ?? 0,
              width: spec.w ?? 200,
              height: spec.h ?? 160,
              // Sticky notes get the yellow palette by default; if the
              // user passed a colour, honour it.
              strokeColor: mapStroke(spec.color ?? "yellow"),
              backgroundColor: BG_BY_COLOR[spec.color ?? "yellow"] ?? BG_BY_COLOR.yellow!,
              fillStyle: "solid",
              strokeWidth: mapStrokeWidth(spec.size),
              roundness: { type: 3 },
              customData: { kind: "note" },
              ...(spec.text
                ? {
                    label: {
                      text: spec.text,
                      fontSize: mapFontSize(spec.size),
                    },
                  }
                : {}),
            });
            break;
          }
          case "frame": {
            // `convertToExcalidrawElements`'s frame variant wants a
            // `children` array of ids. For a fresh frame with no
            // pre-existing children we pass an empty array.
            skeletons.push({
              type: "frame",
              x: spec.x ?? 0,
              y: spec.y ?? 0,
              width: spec.w ?? 400,
              height: spec.h ?? 300,
              name: spec.text ?? undefined,
              children: [],
            });
            break;
          }
          case "arrow": {
            const fromX = spec.x ?? 0;
            const fromY = spec.y ?? 0;
            const startT = resolveTerminal(api, spec.start, {
              x: fromX,
              y: fromY,
            });
            const endT = resolveTerminal(api, spec.end, {
              x: startT.point.x + ARROW_FALLBACK_LENGTH,
              y: startT.point.y,
            });
            // No `start: { id }` / `end: { id }` here — those only
            // resolve within the skeleton array; our bind ids point
            // at existing scene shapes. We record the intent and
            // wire it via `attachArrowBindings` after conversion.
            pendingArrowBindings.push({
              skeletonIndex: skeletons.length,
              startId: startT.bindId,
              endId: endT.bindId,
            });
            skeletons.push({
              type: "arrow",
              x: startT.point.x,
              y: startT.point.y,
              strokeColor: mapStroke(spec.color),
              strokeWidth: mapStrokeWidth(spec.size),
              endArrowhead: "arrow",
              points: [
                [0, 0],
                [
                  endT.point.x - startT.point.x,
                  endT.point.y - startT.point.y,
                ],
              ],
              ...(spec.text
                ? {
                    label: {
                      text: spec.text,
                      fontSize: mapFontSize(spec.size),
                    },
                  }
                : {}),
            });
            break;
          }
          default: {
            skeletons.push({
              type: "rectangle",
              x: spec.x ?? 0,
              y: spec.y ?? 0,
              width: 120,
              height: 60,
              strokeColor: mapStroke("red"),
              backgroundColor: "transparent",
              fillStyle: "hachure",
              strokeWidth: 2,
              label: { text: `unknown:${spec.type}`, fontSize: 16 },
            });
          }
        }
      }

      const createdRaw = convertToExcalidrawElements(skeletons);
      // Only the "top-level" elements (containers, arrows, frames,
      // standalone text) are agent-visible; bound text labels live
      // inside their containers and the agent shouldn't see them as
      // independent ids. We return one id per spec — the n-th
      // skeleton's resulting container/arrow/frame/text.
      //
      // `convertToExcalidrawElements` appends labels AFTER the parent,
      // so the first id of each group is the parent's id.
      const topLevelIds = collectTopLevelIds(createdRaw, skeletons.length);

      // Apply deferred arrow bindings. `topLevelIds[i]` corresponds
      // to `skeletons[i]`, so the arrow we want is found by id.
      const prev = api.getSceneElements();
      let scene: readonly OrderedExcalidrawElement[] = prev;
      const finalCreated = createdRaw.slice();
      for (const pending of pendingArrowBindings) {
        const arrowId = topLevelIds[pending.skeletonIndex];
        if (!arrowId) continue;
        const idx = finalCreated.findIndex((el) => el.id === arrowId);
        if (idx === -1) continue;
        const { arrow: boundArrow, patchedTargets } = attachArrowBindings(
          finalCreated[idx],
          scene,
          { startId: pending.startId, endId: pending.endId },
        );
        finalCreated[idx] = boundArrow;
        if (patchedTargets.size > 0) {
          scene = scene.map((el) => patchedTargets.get(el.id) ?? el);
        }
      }

      api.updateScene({
        elements: [...scene, ...finalCreated],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      return ok({ createdShapeIds: topLevelIds });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_shapes failed",
      );
    }
  });
}

/**
 * `convertToExcalidrawElements` emits elements in roughly the order
 * we passed skeletons in, but interleaves bound text labels right
 * after their containers. We reconstruct the agent-visible "one id
 * per spec" array by skipping anything with a `containerId`
 * (= a bound label).
 */
function collectTopLevelIds(
  created: readonly OrderedExcalidrawElement[],
  expected: number,
): string[] {
  const ids: string[] = [];
  for (const el of created) {
    if ((el as ExcalidrawTextElement).containerId) continue;
    ids.push(el.id);
    if (ids.length >= expected) break;
  }
  return ids;
}

/* ─── connect_shapes ───────────────────────────────────── */

export function executeConnectShapes(
  api: ExcalidrawImperativeAPI,
  input: {
    fromId: string;
    toId: string;
    label?: string;
    color?: string;
    size?: string;
    idempotencyKey?: string;
  },
): ToolResult<{ arrowId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const from = elements.find((e) => e.id === input.fromId);
    const to = elements.find((e) => e.id === input.toId);
    if (!from || !to) {
      const missing = [
        ...(from ? [] : [input.fromId]),
        ...(to ? [] : [input.toId]),
      ];
      return fail(
        "not_found",
        `Shape(s) not found: ${missing.join(", ")}.`,
        "Call `find_shapes` or `query_canvas` to refresh ids.",
      );
    }

    const startPt = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const endPt = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

    try {
      // Build the arrow with NO `start: { id }` / `end: { id }`
      // shortcut — that only resolves ids within the skeleton array,
      // and ours point at scene shapes. `attachArrowBindings` wires
      // them after conversion.
      const created = convertToExcalidrawElements([
        {
          type: "arrow",
          x: startPt.x,
          y: startPt.y,
          strokeColor: mapStroke(input.color),
          strokeWidth: mapStrokeWidth(input.size),
          endArrowhead: "arrow",
          points: [
            [0, 0],
            [endPt.x - startPt.x, endPt.y - startPt.y],
          ],
          ...(input.label
            ? {
                label: {
                  text: input.label,
                  fontSize: mapFontSize(input.size),
                },
              }
            : {}),
        },
      ]);
      const arrow = created.find((el) => el.type === "arrow");
      if (!arrow) {
        return fail("internal", "Arrow element not produced.");
      }

      const { arrow: boundArrow, patchedTargets } = attachArrowBindings(
        arrow,
        elements,
        { startId: from.id, endId: to.id },
      );
      const nextScene = elements.map((el) => patchedTargets.get(el.id) ?? el);
      // Replace the unbound arrow inside `created` with the bound
      // one; everything else (e.g. a label text element) stays put.
      const nextCreated = created.map((el) =>
        el.id === arrow.id ? boundArrow : el,
      );

      api.updateScene({
        elements: [...nextScene, ...nextCreated],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      return ok({ arrowId: arrow.id });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "connect_shapes failed",
      );
    }
  });
}

/* ─── align_shapes ─────────────────────────────────────── *
 *
 * Excalidraw doesn't ship a built-in `alignShapes`, but "align
 * edges" is six lines of math. We compute the offset per
 * element and rewrite the elements array. Bound text and arrows
 * follow their containers automatically because we move the
 * container's x/y; Excalidraw resolves bound positions on each
 * render.
 */

export function executeAlignShapes(
  api: ExcalidrawImperativeAPI,
  input: {
    shapeIds: string[];
    operation:
      | "left"
      | "right"
      | "top"
      | "bottom"
      | "center-horizontal"
      | "center-vertical";
    idempotencyKey?: string;
  },
): ToolResult<{ alignedShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const present = input.shapeIds.filter((id) => byId.has(id));
    const missing = input.shapeIds.filter((id) => !byId.has(id));
    if (present.length < 2) {
      return fail(
        "not_found",
        `Need at least 2 valid shape ids. Missing: ${missing.join(", ") || "(none)"}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }

    const targets = present.map((id) => byId.get(id)!);
    let anchor = 0;
    switch (input.operation) {
      case "left":
        anchor = Math.min(...targets.map((el) => el.x));
        break;
      case "right":
        anchor = Math.max(...targets.map((el) => el.x + el.width));
        break;
      case "top":
        anchor = Math.min(...targets.map((el) => el.y));
        break;
      case "bottom":
        anchor = Math.max(...targets.map((el) => el.y + el.height));
        break;
      case "center-horizontal": {
        // Vertical centres equalised — i.e. all on one horizontal row.
        const centres = targets.map((el) => el.y + el.height / 2);
        anchor = centres.reduce((a, b) => a + b, 0) / centres.length;
        break;
      }
      case "center-vertical": {
        const centres = targets.map((el) => el.x + el.width / 2);
        anchor = centres.reduce((a, b) => a + b, 0) / centres.length;
        break;
      }
    }

    const next = elements.map((el) => {
      if (!byId.has(el.id) || !input.shapeIds.includes(el.id)) return el;
      switch (input.operation) {
        case "left":
          return { ...el, x: anchor };
        case "right":
          return { ...el, x: anchor - el.width };
        case "top":
          return { ...el, y: anchor };
        case "bottom":
          return { ...el, y: anchor - el.height };
        case "center-horizontal":
          return { ...el, y: anchor - el.height / 2 };
        case "center-vertical":
          return { ...el, x: anchor - el.width / 2 };
        default:
          return el;
      }
    });

    try {
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const warnings =
        missing.length > 0
          ? [`Skipped missing shapes: ${missing.join(", ")}`]
          : undefined;
      return ok({ alignedShapeIds: present }, warnings);
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "align_shapes failed",
      );
    }
  });
}

/* ─── distribute_shapes ────────────────────────────────── */

export function executeDistributeShapes(
  api: ExcalidrawImperativeAPI,
  input: {
    shapeIds: string[];
    axis: "horizontal" | "vertical";
    idempotencyKey?: string;
  },
): ToolResult<{ distributedShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const present = input.shapeIds.filter((id) => byId.has(id));
    const missing = input.shapeIds.filter((id) => !byId.has(id));
    if (present.length < 3) {
      return fail(
        "not_found",
        `Need at least 3 valid shape ids. Missing: ${missing.join(", ") || "(none)"}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }

    // Sort along the distribution axis by leading edge so "evenly
    // spaced" matches user expectations.
    const sorted = [...present].sort((a, b) => {
      const ea = byId.get(a)!;
      const eb = byId.get(b)!;
      return input.axis === "horizontal" ? ea.x - eb.x : ea.y - eb.y;
    });
    const first = byId.get(sorted[0]!)!;
    const last = byId.get(sorted[sorted.length - 1]!)!;

    // Compute total span minus the sum of object sizes — that's the
    // free space — and divide it evenly between gaps.
    const sizes = sorted.map((id) =>
      input.axis === "horizontal" ? byId.get(id)!.width : byId.get(id)!.height,
    );
    const startEdge = input.axis === "horizontal" ? first.x : first.y;
    const endEdge =
      input.axis === "horizontal" ? last.x + last.width : last.y + last.height;
    const totalSpan = endEdge - startEdge;
    const totalSize = sizes.reduce((a, b) => a + b, 0);
    const gap = (totalSpan - totalSize) / (sorted.length - 1);

    // Walk the sorted list and place each shape's leading edge.
    let cursor = startEdge;
    const positions = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      positions.set(sorted[i]!, cursor);
      cursor += sizes[i]! + gap;
    }

    const next = elements.map((el) => {
      const pos = positions.get(el.id);
      if (pos === undefined) return el;
      return input.axis === "horizontal" ? { ...el, x: pos } : { ...el, y: pos };
    });

    try {
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const warnings =
        missing.length > 0
          ? [`Skipped missing shapes: ${missing.join(", ")}`]
          : undefined;
      return ok({ distributedShapeIds: present }, warnings);
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "distribute_shapes failed",
      );
    }
  });
}

/* ─── group_into_frame ─────────────────────────────────── */

export function executeGroupIntoFrame(
  api: ExcalidrawImperativeAPI,
  input: {
    shapeIds: string[];
    title: string;
    padding?: number;
    idempotencyKey?: string;
  },
): ToolResult<{ frameId: string; framedShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const present = input.shapeIds.filter((id) => byId.has(id));
    const missing = input.shapeIds.filter((id) => !byId.has(id));
    if (present.length === 0) {
      return fail(
        "not_found",
        `None of those shapes exist: ${input.shapeIds.join(", ")}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }

    const padding = input.padding ?? 32;
    const targets = present.map((id) => byId.get(id)!);
    const [minX, minY, maxX, maxY] = getCommonBounds(targets);

    try {
      // Build the frame first via the transform helper so it has all
      // required field defaults (version, seed, …).
      const [frameEl] = convertToExcalidrawElements([
        {
          type: "frame",
          x: minX - padding,
          y: minY - padding,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2,
          name: input.title,
          children: [],
        },
      ]);
      if (!frameEl) {
        return fail("internal", "Frame element not produced.");
      }

      // Reparent the target elements into the frame by stamping
      // `frameId` on each. Excalidraw's renderer reads this to clip
      // children inside the frame and move them together.
      const presentSet = new Set(present);
      const next: ExcalidrawElement[] = elements.map((el) =>
        presentSet.has(el.id) ? { ...el, frameId: frameEl.id } : el,
      );
      // Frame goes BEFORE its children in z-order so the children
      // render on top of the frame backdrop.
      next.unshift(frameEl);

      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const warnings =
        missing.length > 0
          ? [`Skipped missing shapes: ${missing.join(", ")}`]
          : undefined;
      return ok(
        { frameId: frameEl.id, framedShapeIds: present },
        warnings,
      );
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "group_into_frame failed",
      );
    }
  });
}

/* ─── add_markdown_card / add_mermaid_card ─────────────── *
 *
 * Cards are persisted as rectangles with `customData.kind` —
 * `card-overlay.tsx` renders the rich HTML on top. This keeps cards
 * fully native to Excalidraw: they participate in selection,
 * dragging, resize, arrow binding, and frame reparenting like any
 * other shape.
 */

export function executeAddMarkdownCard(
  api: ExcalidrawImperativeAPI,
  input: {
    x: number;
    y: number;
    w: number;
    h: number;
    markdown: string;
    idempotencyKey?: string;
  },
): ToolResult<{ shapeId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const [card] = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: input.x,
          y: input.y,
          width: input.w,
          height: input.h,
          // The overlay (`card-overlay.tsx`) renders the rich HTML on
          // top of this rectangle. The rectangle itself stays
          // selectable for drag / resize / arrow binding, so we give
          // it enough stroke to be visible at the low zoom levels
          // the user often drops boards to (10–25%). Background
          // transparent so the overlay shows through.
          strokeColor: "#a3a3a3",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          roundness: { type: 3 },
          customData: { kind: "markdown-card", markdown: input.markdown },
        },
      ]);
      if (!card) return fail("internal", "Card element not produced.");

      const prev = api.getSceneElements();
      api.updateScene({
        elements: [...prev, card],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // Pan/zoom to the new card so the user actually sees what was
      // created. Without this, agent-placed content lands wherever
      // the agent picked in scene-space — which at 10–25 % zoom is
      // typically far outside the visible viewport.
      revealNewElement(api, card);

      return ok({ shapeId: card.id });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_markdown_card failed",
      );
    }
  });
}

export async function executeAddMermaidCard(
  api: ExcalidrawImperativeAPI,
  input: {
    x: number;
    y: number;
    w: number;
    h: number;
    kind: string;
    mermaid: string;
    idempotencyKey?: string;
  },
): Promise<ToolResult<{ shapeId: string }>> {
  return withIdempotencyAsync(input.idempotencyKey, async () => {
    // Validate FIRST — on parse error we return a structured envelope
    // and don't touch the scene. The agent reads
    // `error.code === 'validation_failed'` and retries with fixes.
    try {
      await validateMermaid(input.mermaid);
    } catch (err) {
      return fail(
        "validation_failed",
        err instanceof Error ? err.message : "Invalid Mermaid syntax.",
        "Read the message, fix the source line it points at, and call add_mermaid_card again. After one failed retry, switch to `add_shapes` for a hand-drawn flowchart.",
      );
    }

    try {
      const [card] = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: input.x,
          y: input.y,
          width: input.w,
          height: input.h,
          // See `executeAddMarkdownCard` for why the stroke is visible
          // rather than near-invisible — cards have to be findable
          // even when the user is zoomed all the way out.
          strokeColor: "#a3a3a3",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          roundness: { type: 3 },
          customData: {
            kind: "mermaid-card",
            mermaid: input.mermaid,
            mermaidKind: input.kind,
          },
        },
      ]);
      if (!card) return fail("internal", "Card element not produced.");

      const prev = api.getSceneElements();
      api.updateScene({
        elements: [...prev, card],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      revealNewElement(api, card);

      return ok({ shapeId: card.id });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_mermaid_card failed",
      );
    }
  });
}

/* ─── update_shapes ────────────────────────────────────── */

interface ShapeUpdateInput {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  fill?: string;
  size?: string;
}

export function executeUpdateShapes(
  api: ExcalidrawImperativeAPI,
  input: { shapes: ShapeUpdateInput[]; idempotencyKey?: string },
): ToolResult<{ updatedShapeIds: string[]; missingShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const updated: string[] = [];
    const missing: string[] = [];

    // Build the patch map first; we'll do one array rebuild at the
    // end so we only call `updateScene` once for the whole batch.
    const patches = new Map<string, Record<string, unknown>>();
    // Bound-text relabels are recorded separately because the patch
    // lands on the child text element, not the container.
    const labelRelabels = new Map<string, string>();

    for (const spec of input.shapes) {
      const el = byId.get(spec.id);
      if (!el) {
        missing.push(spec.id);
        continue;
      }
      // Excalidraw elements are deeply readonly at the type level
      // (Readonly<…>), so we build the patch as a plain record and
      // spread it back onto the element below. The runtime mutation
      // is fine — we never alias the original element after this.
      const patch: Record<string, unknown> = {};

      if (spec.x !== undefined) patch.x = spec.x;
      if (spec.y !== undefined) patch.y = spec.y;
      if (spec.w !== undefined) patch.width = spec.w;
      if (spec.h !== undefined) patch.height = spec.h;
      if (spec.color !== undefined) patch.strokeColor = mapStroke(spec.color);
      if (spec.fill !== undefined) {
        patch.fillStyle = mapFillStyle(spec.fill);
        // Updating fill without knowing the colour: keep the
        // element's existing background unless they explicitly went
        // to "none".
        if (spec.fill === "none") patch.backgroundColor = "transparent";
        else if (spec.color)
          patch.backgroundColor = mapBackground(spec.color, spec.fill);
      }
      if (spec.size !== undefined) patch.strokeWidth = mapStrokeWidth(spec.size);

      // Text handling depends on the element type:
      //   - `text` element → mutate `text` directly
      //   - `frame` element → mutate `name`
      //   - container (rect/ellipse/diamond) → relabel the bound text
      //     child, or create one if absent
      //   - arrow → same as container
      if (spec.text !== undefined) {
        if (el.type === "text") {
          patch.text = spec.text;
        } else if (el.type === "frame" || el.type === "magicframe") {
          patch.name = spec.text;
        } else {
          const labelRef = el.boundElements?.find((b) => b.type === "text");
          if (labelRef) {
            labelRelabels.set(labelRef.id, spec.text);
          } else {
            // No bound text yet — best effort: skip the label change
            // and warn. (Creating a brand-new bound text element
            // mid-batch is doable but rare in practice; if it bites
            // us, we can route to `convertToExcalidrawElements` here
            // with a label skeleton.)
            // Silent skip is fine: the agent's update_shapes is
            // mostly used to recolour / resize existing shapes.
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        patches.set(spec.id, patch);
        updated.push(spec.id);
      } else if (labelRelabels.size > 0) {
        // Patch was empty but we did schedule a label relabel for
        // this element — still count it as updated for the agent.
        updated.push(spec.id);
      }
    }

    if (updated.length === 0 && missing.length > 0) {
      return fail(
        "not_found",
        `Couldn't find any of the ${missing.length} requested shape(s). Examples: ${missing.slice(0, 3).join(", ")}.`,
        "Call `query_canvas` or `find_shapes` to refresh ids.",
      );
    }

    try {
      const next = elements.map((el) => {
        const containerPatch = patches.get(el.id);
        const relabel = labelRelabels.get(el.id);
        if (!containerPatch && relabel === undefined) return el;
        const merged = { ...el, ...containerPatch } as ExcalidrawElement;
        if (relabel !== undefined && merged.type === "text") {
          (merged as unknown as { text: string }).text = relabel;
        }
        return merged;
      });

      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "update_shapes failed",
      );
    }

    const warnings =
      missing.length > 0
        ? [
            `Skipped ${missing.length} missing shape${
              missing.length === 1 ? "" : "s"
            }: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
          ]
        : undefined;

    return ok({ updatedShapeIds: updated, missingShapeIds: missing }, warnings);
  });
}

/* ─── delete_shapes ────────────────────────────── */

export function executeDeleteShapes(
  api: ExcalidrawImperativeAPI,
  input: { shapeIds: string[]; idempotencyKey?: string },
): ToolResult<{ deletedShapeIds: string[]; missingShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const present = input.shapeIds.filter((id) => byId.has(id));
    const missing = input.shapeIds.filter((id) => !byId.has(id));
    if (present.length === 0) {
      return fail(
        "not_found",
        "None of those shape ids exist on the canvas.",
        "Call `query_canvas` to refresh.",
      );
    }

    // To delete an element in Excalidraw we mark it `isDeleted: true`
    // — simply removing the entry from the array confuses bound
    // references (text containers, arrow bindings). Excalidraw's
    // reconcile-on-render will tidy bound-text children whose
    // container is gone, and arrow bindings to a deleted shape are
    // silently detached.
    const toDelete = new Set(present);
    // Also tombstone bound text children of any deleted container so
    // we don't leave orphan labels floating on the canvas.
    for (const id of present) {
      const el = byId.get(id);
      if (!el?.boundElements) continue;
      for (const ref of el.boundElements) {
        if (ref.type === "text") toDelete.add(ref.id);
      }
    }

    try {
      const next = elements.map((el) =>
        toDelete.has(el.id)
          ? ({ ...el, isDeleted: true } as ExcalidrawElement)
          : el,
      );
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "delete_shapes failed",
      );
    }

    const warnings =
      missing.length > 0
        ? [`Skipped ${missing.length} missing shape(s): ${missing.join(", ")}`]
        : undefined;
    return ok({ deletedShapeIds: present, missingShapeIds: missing }, warnings);
  });
}
