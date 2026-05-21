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

/* ─── shared spatial helpers ───────────────────────────── *
 *
 * All four S1 tools share the same primitives: "what's the centre
 * of X?" / "are these rectangles overlapping?" / "where's the
 * viewport centre right now?". Pulled out so the per-tool
 * implementations below stay readable.
 */

interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectFromElement(el: NonDeletedExcalidrawElement): SceneRect {
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

function rectCentre(r: SceneRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function rectsOverlap(a: SceneRect, b: SceneRect, gap = 0): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/** Page-space centre of the viewport. */
function viewportCentre(state: AppState): { x: number; y: number } {
  const vp = viewportSceneBounds(state);
  return { x: (vp.minX + vp.maxX) / 2, y: (vp.minY + vp.maxY) / 2 };
}

/** Page-space centre of whatever is currently selected, or null. */
function selectionCentre(
  state: AppState,
  elementsById: Map<string, NonDeletedExcalidrawElement>,
): { x: number; y: number } | null {
  const ids = Object.keys(state.selectedElementIds ?? {});
  const els = ids
    .map((id) => elementsById.get(id))
    .filter((e): e is NonDeletedExcalidrawElement => Boolean(e));
  if (els.length === 0) return null;
  // Use the common bounds centre, not the average of centres — a
  // mixed selection of one big and one small shape feels right
  // when we frame the bigger one's bulk.
  const [minX, minY, maxX, maxY] = getCommonBounds(els);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Resolve a "near" anchor (shapeId | point | "selection" | "viewport")
 * to a concrete focal point. Returns the source shape id when the
 * anchor was a shape ref, so callers can exclude it from results.
 */
function resolveFocal(
  api: ExcalidrawImperativeAPI,
  near:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport"
    | undefined,
): {
  x: number;
  y: number;
  sourceShapeId: string | null;
} | { error: string } {
  const state = api.getAppState();
  const elements = api.getSceneElements();
  const elementsById = makeElementsById(elements);

  if (near === undefined || near === "viewport") {
    return { ...viewportCentre(state), sourceShapeId: null };
  }
  if (near === "selection") {
    const c = selectionCentre(state, elementsById);
    if (c) return { ...c, sourceShapeId: null };
    // Empty selection — fall back to viewport. Documented in the
    // tool's input schema description.
    return { ...viewportCentre(state), sourceShapeId: null };
  }
  if ("shapeId" in near) {
    const el = elementsById.get(near.shapeId);
    if (!el) {
      return {
        error: `Shape not found: ${near.shapeId}. Call find_shapes or query_canvas to refresh ids.`,
      };
    }
    const c = rectCentre(rectFromElement(el));
    return { ...c, sourceShapeId: el.id };
  }
  return { x: near.x, y: near.y, sourceShapeId: null };
}

/** Dominant cardinal direction from focal to candidate (centre→centre). */
function dominantDirection(
  focal: { x: number; y: number },
  cand: { x: number; y: number },
): "above" | "below" | "left" | "right" {
  const dx = cand.x - focal.x;
  const dy = cand.y - focal.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "below" : "above";
}

/* ─── query_neighborhood ────────────────────────────────── */

export interface QueryNeighborhoodInput {
  near:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport";
  radius?: number;
  direction?: "any" | "above" | "below" | "left" | "right";
  types?: string[];
  limit?: number;
}

export interface NeighborhoodMatch extends ShapeRow {
  distance: number;
  direction: "above" | "below" | "left" | "right";
}

export interface QueryNeighborhoodOutput {
  focal: { x: number; y: number; sourceShapeId: string | null };
  matches: NeighborhoodMatch[];
  totalMatched: number;
  truncated: boolean;
}

const NEIGHBORHOOD_DEFAULT_RADIUS = 600;
const NEIGHBORHOOD_DEFAULT_LIMIT = 12;

export function executeQueryNeighborhood(
  api: ExcalidrawImperativeAPI,
  input: QueryNeighborhoodInput,
): ToolResult<QueryNeighborhoodOutput> {
  try {
    const focal = resolveFocal(api, input.near);
    if ("error" in focal) {
      return fail("not_found", focal.error);
    }

    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const radius = input.radius ?? NEIGHBORHOOD_DEFAULT_RADIUS;
    const limit = input.limit ?? NEIGHBORHOOD_DEFAULT_LIMIT;
    const dirFilter = input.direction ?? "any";
    const typeFilter = input.types ? new Set(input.types) : null;

    const candidates: NeighborhoodMatch[] = [];
    for (const el of elements) {
      // Skip the focal shape itself when `near` was a shape ref —
      // returning it as its own neighbour is never useful.
      if (focal.sourceShapeId && el.id === focal.sourceShapeId) continue;
      // Bound text labels are noise — they're part of their container.
      if (
        el.type === "text" &&
        (el as ExcalidrawTextElement).containerId
      ) {
        continue;
      }
      const agentType = inferAgentType(el);
      if (typeFilter && !typeFilter.has(agentType)) continue;

      const cent = rectCentre(rectFromElement(el));
      const dx = cent.x - focal.x;
      const dy = cent.y - focal.y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      const dir = dominantDirection(focal, cent);
      if (dirFilter !== "any" && dir !== dirFilter) continue;

      candidates.push({
        ...elementToRow(el, elementsById),
        distance: Math.round(distance),
        direction: dir,
      });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const truncated = candidates.length > limit;
    const matches = candidates.slice(0, limit);

    return ok({
      focal: {
        x: focal.x,
        y: focal.y,
        sourceShapeId: focal.sourceShapeId,
      },
      matches,
      totalMatched: candidates.length,
      truncated,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "query_neighborhood failed",
    );
  }
}

/* ─── get_connections ───────────────────────────────────── */

export interface GetConnectionsInput {
  shapeId: string;
  direction?: "in" | "out" | "both";
  includeUnboundEndpoints?: boolean;
}

export interface ConnectionRow {
  arrowId: string;
  arrowLabel?: string;
  direction: "out" | "in";
  other: ShapeRow | null;
}

export interface GetConnectionsOutput {
  shape: ShapeRow;
  connections: ConnectionRow[];
}

export function executeGetConnections(
  api: ExcalidrawImperativeAPI,
  input: GetConnectionsInput,
): ToolResult<GetConnectionsOutput> {
  try {
    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const focal = elementsById.get(input.shapeId);
    if (!focal) {
      return fail(
        "not_found",
        `Shape not found: ${input.shapeId}.`,
        "Call find_shapes or query_canvas to refresh ids.",
      );
    }

    const dir = input.direction ?? "both";
    const wantIn = dir === "in" || dir === "both";
    const wantOut = dir === "out" || dir === "both";
    const includeUnbound = Boolean(input.includeUnboundEndpoints);

    // Walk the focal shape's boundElements — each entry of type
    // "arrow" is an edge that has one endpoint on this shape.
    // We then read the arrow itself to determine which end it is,
    // and (if bound) what shape sits on the other end.
    const rows: ConnectionRow[] = [];
    const bound = (
      focal as { boundElements?: readonly { id: string; type: string }[] }
    ).boundElements;
    if (bound) {
      for (const ref of bound) {
        if (ref.type !== "arrow") continue;
        const arrow = elementsById.get(ref.id);
        if (!arrow || arrow.type !== "arrow") continue;
        const start = (
          arrow as { startBinding?: { elementId: string } | null }
        ).startBinding?.elementId;
        const end = (
          arrow as { endBinding?: { elementId: string } | null }
        ).endBinding?.elementId;

        // Determine which end belongs to the focal shape.
        let direction: "out" | "in" | null = null;
        let otherId: string | null = null;
        if (start === focal.id) {
          direction = "out";
          otherId = end ?? null;
        } else if (end === focal.id) {
          direction = "in";
          otherId = start ?? null;
        }
        if (!direction) continue;
        if (direction === "out" && !wantOut) continue;
        if (direction === "in" && !wantIn) continue;

        const other = otherId ? elementsById.get(otherId) : null;
        if (!other && !includeUnbound) continue;

        rows.push({
          arrowId: arrow.id,
          arrowLabel: getElementText(arrow, elementsById),
          direction,
          other: other ? elementToRow(other, elementsById) : null,
        });
      }
    }

    return ok({
      shape: elementToRow(focal, elementsById),
      connections: rows,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "get_connections failed",
    );
  }
}

/* ─── find_free_space ───────────────────────────────────── *
 *
 * Spiral outward from the focal point, testing axis-aligned slots
 * of the requested size. The first slot that doesn't overlap any
 * existing shape (with a configurable gap) wins. Frames are
 * skipped — they're containers, not obstacles.
 *
 * Cheap on small/medium boards (≤ a few hundred shapes). On very
 * large boards we fall back to a relaxed result rather than
 * stalling: the agent is warned via `relaxed: true` and can choose
 * to call again with a different anchor.
 */

export interface FindFreeSpaceInput {
  size: { w: number; h: number };
  near?:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport";
  preferDirection?: "right" | "below" | "left" | "above" | "any";
  gap?: number;
}

export interface FindFreeSpaceOutput {
  x: number;
  y: number;
  w: number;
  h: number;
  attempts: number;
  relaxed: boolean;
}

const FREE_SPACE_DEFAULT_GAP = 48;
const FREE_SPACE_MAX_ATTEMPTS = 60;
/** Step size used when spiralling outward — roughly one column. */
const FREE_SPACE_STEP_BASE = 80;

export function executeFindFreeSpace(
  api: ExcalidrawImperativeAPI,
  input: FindFreeSpaceInput,
): ToolResult<FindFreeSpaceOutput> {
  try {
    const focal = resolveFocal(api, input.near);
    if ("error" in focal) {
      return fail("not_found", focal.error);
    }

    const elements = api.getSceneElements();
    const gap = input.gap ?? FREE_SPACE_DEFAULT_GAP;
    const { w, h } = input.size;

    // Obstacles = every shape EXCEPT frames (which are containers,
    // and shapes inside them) and arrows (treating arrows as
    // obstacles produces unusable layouts because they cross
    // everything). Bound text labels are part of their container's
    // footprint already, so skip them too.
    const obstacles: SceneRect[] = [];
    for (const el of elements) {
      if (el.type === "frame" || el.type === "magicframe") continue;
      if (el.type === "arrow") continue;
      if (
        el.type === "text" &&
        (el as ExcalidrawTextElement).containerId
      ) {
        continue;
      }
      obstacles.push(rectFromElement(el));
    }

    // Candidate generator: spiral around the focal point. We sweep
    // along a directional sequence so `preferDirection` actually
    // biases the result.
    const baseStep = Math.max(
      FREE_SPACE_STEP_BASE,
      Math.round(Math.min(w, h) / 2),
    );
    const dir = input.preferDirection ?? "any";
    const order: Array<"right" | "below" | "left" | "above"> =
      dir === "any"
        ? ["right", "below", "left", "above"]
        : (() => {
            const all: Array<"right" | "below" | "left" | "above"> = [
              "right",
              "below",
              "left",
              "above",
            ];
            const idx = all.indexOf(dir);
            return [...all.slice(idx), ...all.slice(0, idx)];
          })();

    /** Candidate top-left for a given (ring, sideIndex). */
    const candidateFor = (
      ring: number,
      side: "right" | "below" | "left" | "above",
    ): { x: number; y: number } => {
      const offset = ring * baseStep;
      // Place the requested size centred along the perpendicular
      // axis. This keeps the new content roughly aligned with the
      // focal point rather than drifting sideways.
      switch (side) {
        case "right":
          return { x: focal.x + offset, y: focal.y - h / 2 };
        case "left":
          return { x: focal.x - offset - w, y: focal.y - h / 2 };
        case "below":
          return { x: focal.x - w / 2, y: focal.y + offset };
        case "above":
          return { x: focal.x - w / 2, y: focal.y - offset - h };
      }
    };

    let attempts = 0;
    // Ring 0 puts the candidate centred on the focal — only valid
    // on an empty board, but worth trying first.
    for (let ring = 0; ring < FREE_SPACE_MAX_ATTEMPTS / order.length; ring++) {
      for (const side of order) {
        attempts++;
        const c = candidateFor(ring, side);
        const cand: SceneRect = { x: c.x, y: c.y, w, h };
        const collides = obstacles.some((o) => rectsOverlap(cand, o, gap));
        if (!collides) {
          return ok({
            x: cand.x,
            y: cand.y,
            w,
            h,
            attempts,
            relaxed: false,
          });
        }
        if (attempts >= FREE_SPACE_MAX_ATTEMPTS) break;
      }
      if (attempts >= FREE_SPACE_MAX_ATTEMPTS) break;
    }

    // Exhausted the budget. Return the far edge of the last ring
    // in the preferred direction so the agent at least gets a slot
    // outside the cluster, with `relaxed: true` to signal we
    // didn't fully verify it.
    const fallback = candidateFor(
      Math.ceil(FREE_SPACE_MAX_ATTEMPTS / order.length),
      order[0]!,
    );
    return ok({
      x: fallback.x,
      y: fallback.y,
      w,
      h,
      attempts,
      relaxed: true,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "find_free_space failed",
    );
  }
}

/* ─── query_frame ───────────────────────────────────────── */

export interface QueryFrameInput {
  frameId: string;
}

export interface QueryFrameOutput {
  frame: ShapeRow;
  children: ShapeRow[];
  bounds: { x: number; y: number; w: number; h: number };
}

export function executeQueryFrame(
  api: ExcalidrawImperativeAPI,
  input: QueryFrameInput,
): ToolResult<QueryFrameOutput> {
  try {
    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const frame = elementsById.get(input.frameId);
    if (!frame) {
      return fail(
        "not_found",
        `Frame not found: ${input.frameId}.`,
        "Call find_shapes type=frame to list frames on the canvas.",
      );
    }
    if (frame.type !== "frame" && frame.type !== "magicframe") {
      return fail(
        "invalid_input",
        `Shape ${input.frameId} is not a frame (type=${frame.type}).`,
        "Use find_shapes with type=frame to locate frames.",
      );
    }

    // Children are any element whose `frameId` points at this frame.
    const children: ShapeRow[] = [];
    for (const el of elements) {
      if (el.id === frame.id) continue;
      const fid = (el as { frameId?: string | null }).frameId;
      if (fid !== frame.id) continue;
      // Skip bound text labels — they're rendered with their containers.
      if (
        el.type === "text" &&
        (el as ExcalidrawTextElement).containerId
      ) {
        continue;
      }
      children.push(elementToRow(el, elementsById));
    }

    return ok({
      frame: elementToRow(frame, elementsById),
      children,
      bounds: {
        x: frame.x,
        y: frame.y,
        w: frame.width,
        h: frame.height,
      },
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "query_frame failed",
    );
  }
}

/* ─── set_selection ─────────────────────────────────────── *
 *
 * Replaces appState.selectedElementIds. Excalidraw treats
 * selection as a record of `{ [id]: true }`. Missing ids are
 * filtered (no point selecting ghosts). Idempotency-keyed so a
 * repeat tool call inside the dedupe window is a no-op.
 */

export interface SetSelectionInput {
  shapeIds: string[];
  idempotencyKey?: string;
}

export interface SetSelectionOutput {
  selectedShapeIds: string[];
  missingShapeIds: string[];
}

export function executeSetSelection(
  api: ExcalidrawImperativeAPI,
  input: SetSelectionInput,
): ToolResult<SetSelectionOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const elements = api.getSceneElements();
      const byId = new Map(elements.map((el) => [el.id, true as const]));
      const present = input.shapeIds.filter((id) => byId.has(id));
      const missing = input.shapeIds.filter((id) => !byId.has(id));

      const selectedElementIds: Record<string, true> = {};
      for (const id of present) selectedElementIds[id] = true;

      api.updateScene({
        appState: { selectedElementIds },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const warnings =
        missing.length > 0
          ? [`Selection skipped missing ids: ${missing.join(", ")}`]
          : undefined;
      return ok(
        { selectedShapeIds: present, missingShapeIds: missing },
        warnings,
      );
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "set_selection failed",
      );
    }
  });
}

/* ─── focus_camera ──────────────────────────────────────── *
 *
 * Pan + zoom to fit a target. Built on `scrollToContent`, which
 * Excalidraw already exposes for our reveal-on-create flow.
 * Either `shapeIds` OR `bounds` must be given.
 */

export interface FocusCameraInput {
  shapeIds?: string[];
  bounds?: { x: number; y: number; w: number; h: number };
  padding?: number;
  animate?: boolean;
}

export interface FocusCameraOutput {
  framed: { x: number; y: number; w: number; h: number };
}

export function executeFocusCamera(
  api: ExcalidrawImperativeAPI,
  input: FocusCameraInput,
): ToolResult<FocusCameraOutput> {
  try {
    const elements = api.getSceneElements();
    const elementsById = makeElementsById(elements);
    const padding = input.padding ?? 0.15;
    const animate = input.animate ?? true;

    let framed: { x: number; y: number; w: number; h: number };
    let target: ExcalidrawElement[] | undefined;

    if (input.shapeIds && input.shapeIds.length > 0) {
      const present = input.shapeIds
        .map((id) => elementsById.get(id))
        .filter((e): e is NonDeletedExcalidrawElement => Boolean(e));
      if (present.length === 0) {
        return fail(
          "not_found",
          `None of those shape ids exist: ${input.shapeIds.join(", ")}.`,
          "Call find_shapes or query_canvas to refresh ids.",
        );
      }
      target = present as ExcalidrawElement[];
      const [minX, minY, maxX, maxY] = getCommonBounds(present);
      framed = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } else if (input.bounds) {
      framed = input.bounds;
    } else {
      return fail(
        "invalid_input",
        "focus_camera needs either `shapeIds` or `bounds`.",
      );
    }

    // `scrollToContent` accepts a shape array; for raw bounds we
    // synthesise a transient hidden rectangle and pass it in.
    // It never lands on the scene because we don't call updateScene.
    const fitTarget: ExcalidrawElement[] =
      target ??
      (convertToExcalidrawElements([
        {
          type: "rectangle",
          x: framed.x,
          y: framed.y,
          width: framed.w,
          height: framed.h,
        },
      ]) as ExcalidrawElement[]);

    api.scrollToContent(fitTarget, {
      fitToContent: true,
      animate,
      duration: animate ? 350 : 0,
      // viewportZoomFactor = 1 - padding so the target covers
      // (1 - padding) of the viewport. 0.15 default = 85 % coverage.
      viewportZoomFactor: Math.max(0.1, Math.min(1, 1 - padding)),
    });

    return ok({ framed });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "focus_camera failed",
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

/**
 * Side anchor → fixedPoint conversion. Excalidraw elbow arrows take
 * a normalized [u, v] coord on the shape's bounding box (each in
 * 0..1). `"auto"` returns `null` so the elbow router picks an edge
 * itself.
 */
function sideToFixedPoint(
  side: "auto" | "left" | "right" | "top" | "bottom" | undefined,
): [number, number] | null {
  switch (side) {
    case "left":
      return [0, 0.5];
    case "right":
      return [1, 0.5];
    case "top":
      return [0.5, 0];
    case "bottom":
      return [0.5, 1];
    default:
      return null;
  }
}

/**
 * Edge-midpoint of a shape, used as the arrow's tail/head position
 * when `direct` routing needs a side hint. Excalidraw's binding
 * resolver picks the edge nearest the terminal point, so placing
 * the terminal AT the edge is the most reliable way to force a
 * specific side without going elbow.
 */
/**
 * Compute the best attachment point on a shape for an arrow endpoint.
 *
 * When `side` is explicit, we return that edge's midpoint.
 * When `side` is `"auto"`, we pick whichever of the 4 edge midpoints
 * is closest to `otherPt` (typically the other shape's center). This
 * means arrows route *around* shapes rather than through their
 * centers, so text inside tall / wide elements is never covered.
 *
 * If `otherPt` is omitted (backward compat), `"auto"` falls back to
 * the shape centre — the historical behaviour.
 */
function edgePoint(
  el: { x: number; y: number; width: number; height: number },
  side: "auto" | "left" | "right" | "top" | "bottom" | undefined,
  otherPt?: { x: number; y: number },
): { x: number; y: number } {
  switch (side) {
    case "left":
      return { x: el.x, y: el.y + el.height / 2 };
    case "right":
      return { x: el.x + el.width, y: el.y + el.height / 2 };
    case "top":
      return { x: el.x + el.width / 2, y: el.y };
    case "bottom":
      return { x: el.x + el.width / 2, y: el.y + el.height };
    case "auto":
    case undefined: {
      if (!otherPt) {
        return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
      }
      // Pick the edge midpoint closest to the other shape's centre.
      // Right edge gets a tiny bonus so text (usually left-aligned)
      // isn't the first thing an arrow hits.
      const candidates: { x: number; y: number; bonus?: number }[] = [
        { x: el.x, y: el.y + el.height / 2 },
        { x: el.x + el.width, y: el.y + el.height / 2, bonus: -1 },
        { x: el.x + el.width / 2, y: el.y },
        { x: el.x + el.width / 2, y: el.y + el.height },
        { x: el.x + el.width / 2, y: el.y + el.height / 2 },
      ];
      let best = candidates[0];
      let bestDist = Infinity;
      for (const c of candidates) {
        const dx = c.x - otherPt.x;
        const dy = c.y - otherPt.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + (c.bonus ?? 0);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      return { x: best.x, y: best.y };
    }
    default:
      return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  }
}

function attachArrowBindings(
  arrow: OrderedExcalidrawElement,
  scene: readonly OrderedExcalidrawElement[],
  bindings: {
    startId?: string | null;
    endId?: string | null;
    /** When set, produces a `FixedPointBinding` (required for elbow arrows). */
    startFixedPoint?: [number, number] | null;
    endFixedPoint?: [number, number] | null;
  },
): {
  arrow: OrderedExcalidrawElement;
  patchedTargets: Map<string, OrderedExcalidrawElement>;
} {
  const patched = new Map<string, OrderedExcalidrawElement>();
  let nextArrow: OrderedExcalidrawElement = arrow;

  const stamp = (
    targetId: string | null | undefined,
    side: "startBinding" | "endBinding",
    fixedPoint: [number, number] | null | undefined,
  ) => {
    if (!targetId) return;
    const target = scene.find((e) => e.id === targetId);
    if (!target) return;
    const binding: Record<string, unknown> = {
      elementId: targetId,
      ...BINDING_DEFAULTS,
    };
    if (fixedPoint) binding.fixedPoint = fixedPoint;
    nextArrow = {
      ...nextArrow,
      [side]: binding,
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

  stamp(
    bindings.startId ?? null,
    "startBinding",
    bindings.startFixedPoint,
  );
  stamp(bindings.endId ?? null, "endBinding", bindings.endFixedPoint);

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

/* ─── connect_shapes / connect_many shared builder ─────── *
 *
 * `buildBoundArrow` turns one edge spec into the elements that
 * need to land on the canvas (an arrow, optionally a bound text
 * label) plus the patch map for the source/target shapes'
 * `boundElements`. Used by both single (`connect_shapes`) and
 * batch (`connect_many`) flows. Keeping a single builder means
 * side-anchor + routing semantics are guaranteed identical
 * between the two entry points.
 */

interface EdgeSpec {
  fromId: string;
  toId: string;
  label?: string;
  color?: string;
  size?: string;
  fromSide?: "auto" | "left" | "right" | "top" | "bottom";
  toSide?: "auto" | "left" | "right" | "top" | "bottom";
  routing?: "direct" | "orthogonal";
}

function buildBoundArrow(
  scene: readonly OrderedExcalidrawElement[],
  spec: EdgeSpec,
):
  | {
      created: readonly OrderedExcalidrawElement[];
      arrowId: string;
      patchedTargets: Map<string, OrderedExcalidrawElement>;
    }
  | { error: string } {
  const from = scene.find((e) => e.id === spec.fromId);
  const to = scene.find((e) => e.id === spec.toId);
  if (!from || !to) {
    const missing = [
      ...(from ? [] : [spec.fromId]),
      ...(to ? [] : [spec.toId]),
    ];
    return { error: `Shape(s) not found: ${missing.join(", ")}.` };
  }

  // Pick anchor points. When no explicit side is given ("auto"),
  // we pass the other shape's centre so `edgePoint` can choose the
  // nearest edge — arrows then route around shapes instead of
  // through their centres.
  const routing = spec.routing ?? "direct";
  const elbowed = routing === "orthogonal";
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const startPt = edgePoint(
    from,
    elbowed ? "auto" : spec.fromSide,
    spec.fromSide === "auto" || (!spec.fromSide && !elbowed) ? toCenter : undefined,
  );
  const endPt = edgePoint(
    to,
    elbowed ? "auto" : spec.toSide,
    spec.toSide === "auto" || (!spec.toSide && !elbowed) ? fromCenter : undefined,
  );

  // Build the arrow with NO `start: { id }` / `end: { id }`
  // shortcut — that only resolves ids within the skeleton array,
  // and ours point at scene shapes. `attachArrowBindings` wires
  // them after conversion.
  // The skeleton type is internal-ish — `ExcalidrawElementSkeleton` is
  // an `Extract<…>` of element variants minus a few unsupported ones.
  // We type as `Record<string, unknown>` for the build phase and cast
  // at the call site; the converter validates at runtime anyway.
  const skeleton: Record<string, unknown> = {
    type: "arrow",
    x: startPt.x,
    y: startPt.y,
    strokeColor: mapStroke(spec.color),
    strokeWidth: mapStrokeWidth(spec.size),
    endArrowhead: "arrow",
    points: [
      [0, 0],
      [endPt.x - startPt.x, endPt.y - startPt.y],
    ],
    ...(spec.label
      ? {
          label: {
            text: spec.label,
            fontSize: mapFontSize(spec.size),
          },
        }
      : {}),
  };
  // Elbow arrows are a separate element subtype. `elbowed: true`
  // signals Excalidraw to lay the arrow out with right-angled
  // segments — exactly what architecture diagrams want.
  if (elbowed) {
    (skeleton as unknown as { elbowed: true }).elbowed = true;
  }

  const created = convertToExcalidrawElements([
    skeleton as unknown as Parameters<
      typeof convertToExcalidrawElements
    >[0] extends Array<infer T> | null
      ? T
      : never,
  ]);
  const arrow = created.find((el) => el.type === "arrow");
  if (!arrow) {
    return { error: "Arrow element not produced." };
  }

  // Elbow arrows need FixedPointBinding (with `fixedPoint`). For
  // `auto` on an elbow arrow we leave fixedPoint null and let the
  // router pick.
  const startFixedPoint = elbowed ? sideToFixedPoint(spec.fromSide) : null;
  const endFixedPoint = elbowed ? sideToFixedPoint(spec.toSide) : null;

  const { arrow: boundArrow, patchedTargets } = attachArrowBindings(
    arrow,
    scene,
    {
      startId: from.id,
      endId: to.id,
      startFixedPoint,
      endFixedPoint,
    },
  );
  // Replace the unbound arrow inside `created` with the bound one;
  // everything else (e.g. a label text element) stays put.
  const finalCreated = created.map((el) =>
    el.id === arrow.id ? boundArrow : el,
  );

  return { created: finalCreated, arrowId: arrow.id, patchedTargets };
}

/* ─── connect_shapes ───────────────────────────────────── */

export interface ConnectShapesInput {
  fromId: string;
  toId: string;
  label?: string;
  fromSide?: "auto" | "left" | "right" | "top" | "bottom";
  toSide?: "auto" | "left" | "right" | "top" | "bottom";
  routing?: "direct" | "orthogonal";
  color?: string;
  size?: string;
  idempotencyKey?: string;
}

export function executeConnectShapes(
  api: ExcalidrawImperativeAPI,
  input: ConnectShapesInput,
): ToolResult<{ arrowId: string }> {
  return withIdempotency(input.idempotencyKey, () => {
    const elements = api.getSceneElements();
    const built = buildBoundArrow(elements, input);
    if ("error" in built) {
      return fail(
        "not_found",
        built.error,
        "Call `find_shapes` or `query_canvas` to refresh ids.",
      );
    }

    try {
      const nextScene = elements.map(
        (el) => built.patchedTargets.get(el.id) ?? el,
      );
      api.updateScene({
        elements: [...nextScene, ...built.created],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return ok({ arrowId: built.arrowId });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "connect_shapes failed",
      );
    }
  });
}

/* ─── connect_many ─────────────────────────────────────── *
 *
 * Apply N edges in a single `updateScene`. Each successive edge
 * sees the patches from prior edges so that fan-outs into the
 * same target accumulate boundElements correctly. Failures don't
 * abort the batch — they're collected in `skipped` with the
 * original index so the agent can retry just the bad ones.
 */

export interface ConnectManyInput {
  edges: EdgeSpec[];
  idempotencyKey?: string;
}

export interface ConnectManyOutput {
  arrowIds: string[];
  skipped: Array<{ index: number; reason: string }>;
}

export function executeConnectMany(
  api: ExcalidrawImperativeAPI,
  input: ConnectManyInput,
): ToolResult<ConnectManyOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      // Maintain a virtual scene that accumulates patches across
      // edges. This is critical for fan-in / fan-out cases — the
      // second arrow into a shape needs to see the boundElements
      // entry added by the first arrow, or it'll clobber it.
      let virtualScene = api.getSceneElements() as readonly OrderedExcalidrawElement[];
      const allCreated: OrderedExcalidrawElement[] = [];
      const arrowIds: string[] = [];
      const skipped: Array<{ index: number; reason: string }> = [];

      input.edges.forEach((edge, index) => {
        const built = buildBoundArrow(virtualScene, edge);
        if ("error" in built) {
          arrowIds.push("");
          skipped.push({ index, reason: built.error });
          return;
        }
        // Apply target patches to the virtual scene so subsequent
        // edges see them.
        virtualScene = virtualScene.map(
          (el) => built.patchedTargets.get(el.id) ?? el,
        );
        // Append the new elements (arrow + optional bound label)
        // to the virtual scene as well — a follow-up edge might
        // need to bind to this arrow (rare, but possible).
        virtualScene = [...virtualScene, ...built.created];
        allCreated.push(...built.created);
        arrowIds.push(built.arrowId);
      });

      // Single updateScene with the final accumulated virtual
      // scene. `allCreated` is already inside `virtualScene` so we
      // don't append it again.
      api.updateScene({
        elements: virtualScene as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const warnings =
        skipped.length > 0
          ? [`Skipped ${skipped.length} edge(s); inspect \`skipped\` for details.`]
          : undefined;
      return ok({ arrowIds, skipped }, warnings);
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "connect_many failed",
      );
    }
  });
}

/* ─── relabel_arrows ───────────────────────────────────── *
 *
 * Arrow labels in Excalidraw are bound text elements whose
 * `containerId` points at the arrow. To set/change a label:
 *
 *   - Already labelled (boundElements has a `text` entry) →
 *     update the text element in place. Cheapest path.
 *
 *   - Not labelled and new text is non-empty → synthesize a
 *     temp arrow matching the real arrow's geometry, extract
 *     the auto-positioned label text element from the
 *     converter's output, rewrite its `containerId` to the real
 *     arrow's id, splice it in.
 *
 *   - Already labelled and new text is empty → tombstone the
 *     bound text element and prune the arrow's `boundElements`.
 */

export interface RelabelArrowsInput {
  labels: Array<{ arrowId: string; text: string }>;
  idempotencyKey?: string;
}

export interface RelabelArrowsOutput {
  updatedArrowIds: string[];
  missingArrowIds: string[];
}

export function executeRelabelArrows(
  api: ExcalidrawImperativeAPI,
  input: RelabelArrowsInput,
): ToolResult<RelabelArrowsOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const elements = api.getSceneElements();
      const byId = new Map(elements.map((el) => [el.id, el]));
      const updatedArrowIds: string[] = [];
      const missingArrowIds: string[] = [];

      // Patches and additions accumulated across all labels;
      // applied in one updateScene at the end.
      const patches = new Map<string, OrderedExcalidrawElement>();
      const toAdd: OrderedExcalidrawElement[] = [];

      for (const { arrowId, text } of input.labels) {
        const arrow = (patches.get(arrowId) ?? byId.get(arrowId)) as
          | OrderedExcalidrawElement
          | undefined;
        if (!arrow || arrow.type !== "arrow") {
          missingArrowIds.push(arrowId);
          continue;
        }

        // Look for existing bound text label.
        const bound = (
          arrow as { boundElements?: readonly { id: string; type: string }[] }
        ).boundElements;
        const textRef = bound?.find((b) => b.type === "text");
        const existingText = textRef
          ? ((patches.get(textRef.id) ?? byId.get(textRef.id)) as
              | (OrderedExcalidrawElement & { text?: string })
              | undefined)
          : undefined;

        if (existingText) {
          if (text === "") {
            // Remove: tombstone the text element and prune the
            // arrow's boundElements entry.
            patches.set(existingText.id, {
              ...existingText,
              isDeleted: true,
            } as OrderedExcalidrawElement);
            patches.set(arrow.id, {
              ...arrow,
              boundElements: (bound ?? []).filter(
                (b) => b.id !== existingText.id,
              ),
            } as OrderedExcalidrawElement);
          } else {
            // Update in place. `originalText` mirrors `text` and is
            // what Excalidraw re-wraps from on re-render.
            patches.set(existingText.id, {
              ...existingText,
              text,
              originalText: text,
              version: ((existingText as { version: number }).version ?? 0) + 1,
              versionNonce: Math.floor(Math.random() * 0x7fffffff),
              updated: Date.now(),
            } as OrderedExcalidrawElement);
          }
          updatedArrowIds.push(arrow.id);
          continue;
        }

        if (text === "") {
          // No-op: requested empty label on already-unlabelled arrow.
          updatedArrowIds.push(arrow.id);
          continue;
        }

        // No existing label, need to synthesize. Build a temp
        // arrow with the same geometry + the desired label, let
        // the converter auto-position a bound text, then rewrite
        // the text's containerId to point at the real arrow.
        const arrowEl = arrow as OrderedExcalidrawElement & {
          x: number;
          y: number;
          points: readonly (readonly [number, number])[];
        };
        const tempCreated = convertToExcalidrawElements([
          {
            type: "arrow",
            x: arrowEl.x,
            y: arrowEl.y,
            points: arrowEl.points as unknown as [number, number][],
            label: { text },
          },
        ]);
        const tempText = tempCreated.find((el) => el.type === "text") as
          | (OrderedExcalidrawElement & { containerId?: string | null })
          | undefined;
        if (!tempText) {
          missingArrowIds.push(arrow.id);
          continue;
        }
        // Rewire to the real arrow.
        const realLabel = {
          ...tempText,
          containerId: arrow.id,
        } as OrderedExcalidrawElement;
        toAdd.push(realLabel);
        patches.set(arrow.id, {
          ...arrow,
          boundElements: [
            ...(bound ?? []),
            { type: "text", id: realLabel.id },
          ],
        } as OrderedExcalidrawElement);
        updatedArrowIds.push(arrow.id);
      }

      if (patches.size === 0 && toAdd.length === 0) {
        const warnings =
          missingArrowIds.length > 0
            ? [`No arrows found: ${missingArrowIds.join(", ")}`]
            : undefined;
        return ok({ updatedArrowIds, missingArrowIds }, warnings);
      }

      const nextScene = [
        ...elements.map((el) => patches.get(el.id) ?? el),
        ...toAdd,
      ];
      api.updateScene({
        elements: nextScene,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const warnings =
        missingArrowIds.length > 0
          ? [`Skipped missing or non-arrow ids: ${missingArrowIds.join(", ")}`]
          : undefined;
      return ok({ updatedArrowIds, missingArrowIds }, warnings);
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "relabel_arrows failed",
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

/* ─── layout_shapes helpers ─────────────────────────────── *
 *
 * All layout kinds share the same final step: we have a Map of
 * { shapeId → new top-left }, and need to translate the whole
 * group so the bounding-box origin matches the requested
 * `origin` (preserve / viewport / shape / point). `applyLayout`
 * does that translation + the actual `updateScene`.
 */

function bboxOfPlacements(
  placements: Map<string, { x: number; y: number }>,
  sizes: Map<string, { w: number; h: number }>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, p] of placements) {
    const s = sizes.get(id)!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + s.w > maxX) maxX = p.x + s.w;
    if (p.y + s.h > maxY) maxY = p.y + s.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ─── layout_shapes ─────────────────────────────────────── */

export interface LayoutShapesInput {
  shapeIds: string[];
  kind: "row" | "column" | "grid" | "tree";
  gap?: { x?: number; y?: number };
  columns?: number;
  rootShapeId?: string;
  direction?: "down" | "right" | "up" | "left";
  origin?:
    | { x: number; y: number }
    | { shapeId: string }
    | "viewport"
    | "preserve";
  idempotencyKey?: string;
}

export interface LayoutShapesOutput {
  laidOutShapeIds: string[];
  missingShapeIds: string[];
  bounds: { x: number; y: number; w: number; h: number };
}

export function executeLayoutShapes(
  api: ExcalidrawImperativeAPI,
  input: LayoutShapesInput,
): ToolResult<LayoutShapesOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const elements = api.getSceneElements();
      const byId = new Map(elements.map((el) => [el.id, el]));
      const present = input.shapeIds.filter((id) => byId.has(id));
      const missing = input.shapeIds.filter((id) => !byId.has(id));
      if (present.length < 2) {
        return fail(
          "not_found",
          `Need at least 2 valid shape ids. Missing: ${missing.join(", ") || "(none)"}.`,
          "Call find_shapes or query_canvas for current ids.",
        );
      }

      const sizes = new Map<string, { w: number; h: number }>();
      for (const id of present) {
        const el = byId.get(id)!;
        sizes.set(id, { w: el.width, h: el.height });
      }

      // Defaults that "just work" for the common cases.
      const defaultGap =
        input.kind === "tree"
          ? { x: 80, y: 120 }
          : { x: 48, y: 48 };
      const gapX = input.gap?.x ?? defaultGap.x;
      const gapY = input.gap?.y ?? defaultGap.y;

      // Capture the pre-layout bounding-box origin so `origin: "preserve"`
      // leaves the cluster anchored where the user dragged it.
      const preTargets = present.map((id) => byId.get(id)!);
      const [preMinX, preMinY] = getCommonBounds(preTargets);

      const placements = new Map<string, { x: number; y: number }>();

      switch (input.kind) {
        case "row": {
          // Equalise vertical centres (looks tidier than top-aligning
          // mixed-height shapes), then walk left to right.
          const centreY =
            preTargets.reduce((acc, el) => acc + el.y + el.height / 2, 0) /
            preTargets.length;
          let cursorX = 0;
          for (const id of present) {
            const s = sizes.get(id)!;
            placements.set(id, { x: cursorX, y: centreY - s.h / 2 });
            cursorX += s.w + gapX;
          }
          break;
        }
        case "column": {
          const centreX =
            preTargets.reduce((acc, el) => acc + el.x + el.width / 2, 0) /
            preTargets.length;
          let cursorY = 0;
          for (const id of present) {
            const s = sizes.get(id)!;
            placements.set(id, { x: centreX - s.w / 2, y: cursorY });
            cursorY += s.h + gapY;
          }
          break;
        }
        case "grid": {
          // Uniform cell size = max of every shape so different sized
          // boxes still align to a clean grid.
          const cols =
            input.columns ?? Math.max(1, Math.ceil(Math.sqrt(present.length)));
          const cellW = Math.max(...present.map((id) => sizes.get(id)!.w));
          const cellH = Math.max(...present.map((id) => sizes.get(id)!.h));
          for (let i = 0; i < present.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const s = sizes.get(present[i]!)!;
            // Centre each shape within its cell so mixed sizes look intentional.
            placements.set(present[i]!, {
              x: col * (cellW + gapX) + (cellW - s.w) / 2,
              y: row * (cellH + gapY) + (cellH - s.h) / 2,
            });
          }
          break;
        }
        case "tree": {
          const root = input.rootShapeId;
          if (!root || !byId.has(root)) {
            return fail(
              "invalid_input",
              `kind=tree requires a valid \`rootShapeId\` from shapeIds (got ${root ?? "undefined"}).`,
            );
          }
          // Build the child-of-node adjacency by walking outgoing arrows
          // among the selected shapes only.
          const selectedSet = new Set(present);
          const children = new Map<string, string[]>();
          for (const id of present) {
            children.set(id, []);
          }
          for (const el of elements) {
            if (el.type !== "arrow") continue;
            const start = (
              el as { startBinding?: { elementId: string } | null }
            ).startBinding?.elementId;
            const end = (
              el as { endBinding?: { elementId: string } | null }
            ).endBinding?.elementId;
            if (!start || !end) continue;
            if (!selectedSet.has(start) || !selectedSet.has(end)) continue;
            if (start === end) continue;
            const list = children.get(start)!;
            if (!list.includes(end)) list.push(end);
          }

          // Reingold-Tilford-lite: count leaf slots per subtree, then
          // place each node centred over its children.
          const leafCount = new Map<string, number>();
          const placedSet = new Set<string>();
          const countLeaves = (id: string, visited: Set<string>): number => {
            if (visited.has(id)) return 1;
            visited.add(id);
            const ch = children.get(id) ?? [];
            if (ch.length === 0) {
              leafCount.set(id, 1);
              return 1;
            }
            let total = 0;
            for (const c of ch) total += countLeaves(c, visited);
            const n = Math.max(1, total);
            leafCount.set(id, n);
            return n;
          };
          countLeaves(root, new Set());

          // Direction: "down" (default) means depth on Y, sibling axis on X.
          const dir = input.direction ?? "down";
          const onYAxis = dir === "down" || dir === "up";
          const reverseDepth = dir === "up" || dir === "left";

          // Slot dimensions sized for the largest shape in the
          // selection so labels don't overlap.
          const slotMain =
            (onYAxis
              ? Math.max(...present.map((id) => sizes.get(id)!.w))
              : Math.max(...present.map((id) => sizes.get(id)!.h))) +
            (onYAxis ? gapX : gapY);
          const layerStep =
            (onYAxis
              ? Math.max(...present.map((id) => sizes.get(id)!.h))
              : Math.max(...present.map((id) => sizes.get(id)!.w))) +
            (onYAxis ? gapY : gapX);

          let nextLeafSlot = 0;
          const place = (
            id: string,
            depth: number,
            visited: Set<string>,
          ): number => {
            if (visited.has(id) || placedSet.has(id)) {
              return nextLeafSlot - 0.5;
            }
            visited.add(id);
            placedSet.add(id);
            const ch = children.get(id) ?? [];
            let centre: number;
            if (ch.length === 0) {
              centre = nextLeafSlot + 0.5;
              nextLeafSlot += 1;
            } else {
              const childCentres: number[] = [];
              for (const c of ch) {
                childCentres.push(place(c, depth + 1, visited));
              }
              centre =
                (childCentres[0]! +
                  childCentres[childCentres.length - 1]!) /
                2;
            }
            const layerIndex = reverseDepth ? -depth : depth;
            const s = sizes.get(id)!;
            if (onYAxis) {
              placements.set(id, {
                x: centre * slotMain - s.w / 2,
                y: layerIndex * layerStep,
              });
            } else {
              placements.set(id, {
                x: layerIndex * layerStep,
                y: centre * slotMain - s.h / 2,
              });
            }
            return centre;
          };
          place(root, 0, new Set());

          // Disconnected nodes — append after the main tree so they
          // don't get lost. Treated as leaves at depth 0.
          for (const id of present) {
            if (placedSet.has(id)) continue;
            const s = sizes.get(id)!;
            const centre = nextLeafSlot + 0.5;
            nextLeafSlot += 1;
            if (onYAxis) {
              placements.set(id, {
                x: centre * slotMain - s.w / 2,
                y: 0,
              });
            } else {
              placements.set(id, {
                x: 0,
                y: centre * slotMain - s.h / 2,
              });
            }
            placedSet.add(id);
          }
          break;
        }
      }

      // Translate placements so the bounding-box origin matches
      // `origin`. `placements` is currently in "local" coords starting
      // near (0, 0) for most kinds.
      const localBounds = bboxOfPlacements(placements, sizes);
      const state = api.getAppState();
      let targetOriginX = preMinX;
      let targetOriginY = preMinY;
      const origin = input.origin ?? "preserve";
      if (origin === "viewport") {
        const vp = viewportSceneBounds(state);
        const vpCentreX = (vp.minX + vp.maxX) / 2;
        const vpCentreY = (vp.minY + vp.maxY) / 2;
        targetOriginX = vpCentreX - localBounds.w / 2;
        targetOriginY = vpCentreY - localBounds.h / 2;
      } else if (typeof origin === "object" && "shapeId" in origin) {
        const anchor = byId.get(origin.shapeId);
        if (!anchor) {
          return fail(
            "not_found",
            `Origin shape not found: ${origin.shapeId}.`,
          );
        }
        targetOriginX = anchor.x;
        targetOriginY = anchor.y;
      } else if (typeof origin === "object" && "x" in origin) {
        targetOriginX = origin.x;
        targetOriginY = origin.y;
      }
      const dx = targetOriginX - localBounds.x;
      const dy = targetOriginY - localBounds.y;

      const next = elements.map((el) => {
        const p = placements.get(el.id);
        if (!p) return el;
        return { ...el, x: p.x + dx, y: p.y + dy };
      });

      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const finalBounds = {
        x: localBounds.x + dx,
        y: localBounds.y + dy,
        w: localBounds.w,
        h: localBounds.h,
      };
      const warnings =
        missing.length > 0
          ? [`Skipped missing shapes: ${missing.join(", ")}`]
          : undefined;
      return ok(
        {
          laidOutShapeIds: present,
          missingShapeIds: missing,
          bounds: finalBounds,
        },
        warnings,
      );
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "layout_shapes failed",
      );
    }
  });
}

/* ─── duplicate_shapes helpers ──────────────────────────── *
 *
 * Excalidraw IDs are short random strings — `randomElementId()`
 * matches the engine's own style. `freshenElement` deep-clones an
 * element with new id + fresh seeds, and remaps every internal id
 * reference (containerId, boundElements, startBinding,
 * endBinding, frameId) through a translation table so cloned
 * groups stay internally consistent.
 */

function randomElementId(): string {
  // Same length / character class Excalidraw uses internally.
  // Don't need cryptographic strength — uniqueness within a session is enough.
  return Math.random().toString(36).slice(2, 12);
}

function freshenElement(
  el: ExcalidrawElement,
  newId: string,
  idMap: Map<string, string>,
): ExcalidrawElement {
  // Start from a shallow clone, then patch ids / refs / version
  // metadata.
  const cloned: Record<string, unknown> = { ...el };
  cloned.id = newId;
  cloned.seed = Math.floor(Math.random() * 2 ** 31);
  cloned.versionNonce = Math.floor(Math.random() * 2 ** 31);
  cloned.version = 1;
  cloned.updated = Date.now();
  // Excalidraw rebuilds these for us when we omit them.
  delete cloned.index;

  // groupIds: regenerate so the duplicate is its own group, not
  // a member of the original's group.
  const groupIds = (el as { groupIds?: readonly string[] }).groupIds;
  if (groupIds && groupIds.length > 0) {
    cloned.groupIds = groupIds.map(
      (gid) => idMap.get(gid) ?? `g-${randomElementId()}`,
    );
  }

  // containerId (bound text → container): remap if container is
  // also being cloned, else clear so the text becomes free-standing.
  const containerId = (el as { containerId?: string | null }).containerId;
  if (containerId) {
    cloned.containerId = idMap.get(containerId) ?? null;
  }

  // frameId: keep pointing at the original frame if frame is not
  // in selection; remap if it is.
  const frameId = (el as { frameId?: string | null }).frameId;
  if (frameId) {
    cloned.frameId = idMap.get(frameId) ?? frameId;
  }

  // boundElements: keep only the entries that refer to ids in the
  // clone set, and remap them. Others are dropped (the original
  // still references them — we don't want the clone to share
  // bound text or arrows with the original).
  const boundElements = (
    el as { boundElements?: readonly { id: string; type: string }[] }
  ).boundElements;
  if (boundElements) {
    cloned.boundElements = boundElements
      .filter((b) => idMap.has(b.id))
      .map((b) => ({ ...b, id: idMap.get(b.id)! }));
  }

  // Arrow start/end bindings: remap. If endpoint isn't in the
  // clone set, drop the binding so the arrow becomes free-floating
  // on that side rather than pointing at the original shape.
  const startBinding = (el as { startBinding?: { elementId: string } | null })
    .startBinding;
  if (startBinding) {
    const mapped = idMap.get(startBinding.elementId);
    cloned.startBinding = mapped
      ? { ...startBinding, elementId: mapped }
      : null;
  }
  const endBinding = (el as { endBinding?: { elementId: string } | null })
    .endBinding;
  if (endBinding) {
    const mapped = idMap.get(endBinding.elementId);
    cloned.endBinding = mapped ? { ...endBinding, elementId: mapped } : null;
  }

  return cloned as ExcalidrawElement;
}

/* ─── duplicate_shapes ──────────────────────────────────── */

export interface DuplicateShapesInput {
  shapeIds: string[];
  count?: number;
  direction?: "right" | "below" | "left" | "above";
  offset?: { dx: number; dy: number };
  labelSuffix?: string;
  idempotencyKey?: string;
}

export interface DuplicateShapesOutput {
  newShapeIds: string[];
  copies: Array<{
    copyIndex: number;
    idMap: Record<string, string>;
  }>;
  missingShapeIds: string[];
  droppedArrows: string[];
}

export function executeDuplicateShapes(
  api: ExcalidrawImperativeAPI,
  input: DuplicateShapesInput,
): ToolResult<DuplicateShapesOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const elements = api.getSceneElements();
      const byId = new Map(elements.map((el) => [el.id, el]));
      const present = input.shapeIds.filter((id) => byId.has(id));
      const missing = input.shapeIds.filter((id) => !byId.has(id));
      if (present.length === 0) {
        return fail(
          "not_found",
          `None of those shapes exist: ${input.shapeIds.join(", ")}.`,
          "Call find_shapes or query_canvas for current ids.",
        );
      }

      // Auto-include bound text labels of selected containers so
      // duplicated boxes keep their captions. The user shouldn't
      // have to pass label ids by hand.
      const selectedSet = new Set(present);
      for (const id of present) {
        const el = byId.get(id)!;
        const bound = (
          el as { boundElements?: readonly { id: string; type: string }[] }
        ).boundElements;
        if (!bound) continue;
        for (const b of bound) {
          if (b.type !== "text") continue;
          const label = byId.get(b.id);
          if (!label) continue;
          if ((label as ExcalidrawTextElement).containerId === id) {
            selectedSet.add(b.id);
          }
        }
      }

      // Identify arrows in the selection that cross the boundary —
      // we drop these instead of trying to clone partially-bound
      // arrows (they'd look broken).
      const droppedArrows: string[] = [];
      const cloneables: ExcalidrawElement[] = [];
      for (const id of selectedSet) {
        const el = byId.get(id)!;
        if (el.type === "arrow") {
          const start = (
            el as { startBinding?: { elementId: string } | null }
          ).startBinding?.elementId;
          const end = (
            el as { endBinding?: { elementId: string } | null }
          ).endBinding?.elementId;
          if (
            (start && !selectedSet.has(start)) ||
            (end && !selectedSet.has(end))
          ) {
            droppedArrows.push(id);
            continue;
          }
        }
        cloneables.push(el);
      }

      if (cloneables.length === 0) {
        return fail(
          "invalid_input",
          "Every shape in the selection was a boundary-crossing arrow.",
          "Pick a selection where arrows stay inside, or include both endpoints.",
        );
      }

      // Resolve the offset per copy. `direction` is sugar for an
      // offset matching the selection's bounding box plus a gap.
      const targets = cloneables;
      const [minX, minY, maxX, maxY] = getCommonBounds(
        targets as NonDeletedExcalidrawElement[],
      );
      const bboxW = maxX - minX;
      const bboxH = maxY - minY;
      const gap = 40;
      let stepDx = 0;
      let stepDy = bboxH + gap; // default: stack below
      if (input.offset) {
        stepDx = input.offset.dx;
        stepDy = input.offset.dy;
      } else if (input.direction) {
        switch (input.direction) {
          case "right":
            stepDx = bboxW + gap;
            stepDy = 0;
            break;
          case "left":
            stepDx = -(bboxW + gap);
            stepDy = 0;
            break;
          case "below":
            stepDx = 0;
            stepDy = bboxH + gap;
            break;
          case "above":
            stepDx = 0;
            stepDy = -(bboxH + gap);
            break;
        }
      }

      const count = input.count ?? 1;
      const suffix = input.labelSuffix ?? "";
      const allNew: ExcalidrawElement[] = [];
      const copies: Array<{
        copyIndex: number;
        idMap: Record<string, string>;
      }> = [];

      for (let n = 1; n <= count; n++) {
        // Build a per-copy id map covering every cloneable id.
        const idMap = new Map<string, string>();
        for (const el of cloneables) {
          idMap.set(el.id, randomElementId());
        }
        const exportedMap: Record<string, string> = {};
        const dx = stepDx * n;
        const dy = stepDy * n;
        for (const el of cloneables) {
          const newId = idMap.get(el.id)!;
          exportedMap[el.id] = newId;
          const fresh = freshenElement(el, newId, idMap);
          // Apply the per-copy offset to position fields.
          const positioned = {
            ...fresh,
            x: (fresh as ExcalidrawElement).x + dx,
            y: (fresh as ExcalidrawElement).y + dy,
          } as ExcalidrawElement;
          // Optional label suffix on text elements.
          if (suffix && positioned.type === "text") {
            const t = positioned as ExcalidrawTextElement & {
              originalText?: string;
            };
            const newText = (t.text ?? "") + suffix;
            (positioned as Record<string, unknown>).text = newText;
            if (t.originalText !== undefined) {
              (positioned as Record<string, unknown>).originalText = newText;
            }
          }
          allNew.push(positioned);
        }
        copies.push({ copyIndex: n, idMap: exportedMap });
      }

      // Drop new elements after existing scene so they render on top.
      const next = [...elements, ...allNew];
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      const newShapeIds = allNew.map((el) => el.id);
      const warnings: string[] = [];
      if (missing.length > 0) {
        warnings.push(`Skipped missing shapes: ${missing.join(", ")}`);
      }
      if (droppedArrows.length > 0) {
        warnings.push(
          `Dropped boundary-crossing arrows: ${droppedArrows.join(", ")}`,
        );
      }
      return ok(
        {
          newShapeIds,
          copies,
          missingShapeIds: missing,
          droppedArrows,
        },
        warnings.length > 0 ? warnings : undefined,
      );
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "duplicate_shapes failed",
      );
    }
  });
}

/* ─── analyze_canvas / explain_diagram ─────────────────── *
 *
 * Inspection tools. Both walk the same canvas state and share
 * helpers (graph build, component find). `analyze_canvas` reports
 * issues as a flat list; `explain_diagram` produces a structured
 * prose summary. Neither mutates state.
 */

export type CanvasIssueKind =
  | "orphan"
  | "dangling_arrow"
  | "overlap"
  | "unlabeled"
  | "off_canvas"
  | "style_drift";

export interface CanvasIssue {
  kind: CanvasIssueKind;
  shapeIds: string[];
  description: string;
  severity: "info" | "warning";
}

export interface AnalyzeCanvasInput {
  categories?: CanvasIssueKind[];
  frameId?: string;
  offCanvasThreshold?: number;
}

export interface AnalyzeCanvasOutput {
  issues: CanvasIssue[];
  summary: { total: number; byCategory: Record<string, number> };
}

interface CanvasGraph {
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
  neighbors: Map<string, Set<string>>;
}

/**
 * Build a directed graph from bound arrows. Unbound arrows
 * contribute nothing (they're surfaced separately by the
 * `dangling_arrow` check).
 */
function buildArrowGraph(
  scene: readonly NonDeletedExcalidrawElement[],
): CanvasGraph {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();
  const bump = (m: Map<string, number>, id: string) =>
    m.set(id, (m.get(id) ?? 0) + 1);
  const link = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  for (const el of scene) {
    if (el.type !== "arrow") continue;
    const start = (el as { startBinding?: { elementId: string } | null })
      .startBinding?.elementId;
    const end = (el as { endBinding?: { elementId: string } | null })
      .endBinding?.elementId;
    if (start && end) {
      bump(outDegree, start);
      bump(inDegree, end);
      link(start, end);
    }
  }
  return { inDegree, outDegree, neighbors };
}

/** Connected components over the undirected neighbour graph. */
function connectedComponents(
  ids: readonly string[],
  neighbors: Map<string, Set<string>>,
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const comp: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      comp.push(cur);
      for (const n of neighbors.get(cur) ?? []) {
        if (!seen.has(n)) stack.push(n);
      }
    }
    components.push(comp);
  }
  return components;
}

/**
 * Whether a shape is something the user "drew" — a candidate for
 * orphan / overlap / unlabeled checks. Arrows, bound text, and
 * frames themselves are excluded (frames are containers).
 */
function isDrawnShape(el: NonDeletedExcalidrawElement): boolean {
  if (el.type === "arrow") return false;
  if (el.type === "frame") return false;
  if (el.type === "text") {
    const containerId = (el as { containerId?: string | null }).containerId;
    return !containerId;
  }
  return true;
}

/** Human label for an element, best-effort. */
function describeShape(el: NonDeletedExcalidrawElement): string {
  const text = (el as { text?: string }).text;
  if (text && text.trim()) return `${el.type} "${text.trim().slice(0, 40)}"`;
  return `${el.type} ${el.id.slice(0, 6)}`;
}

export function executeAnalyzeCanvas(
  api: ExcalidrawImperativeAPI,
  input: AnalyzeCanvasInput,
): ToolResult<AnalyzeCanvasOutput> {
  try {
    const all = api.getSceneElements();

    // Optional frame scope: restrict to elements with frameId === input.frameId
    // (plus the frame itself).
    let scope: readonly NonDeletedExcalidrawElement[] = all;
    if (input.frameId) {
      const frame = all.find((e) => e.id === input.frameId);
      if (!frame) {
        return fail(
          "not_found",
          `Frame not found: ${input.frameId}`,
          "Call query_canvas for current frame ids.",
        );
      }
      scope = all.filter(
        (e) =>
          e.id === input.frameId ||
          (e as { frameId?: string | null }).frameId === input.frameId,
      );
    }

    const requested = new Set<CanvasIssueKind>(
      input.categories ?? [
        "orphan",
        "dangling_arrow",
        "overlap",
        "unlabeled",
        "off_canvas",
        "style_drift",
      ],
    );

    const issues: CanvasIssue[] = [];
    const byId = new Map(scope.map((e) => [e.id, e]));
    const drawn = scope.filter(isDrawnShape);
    const graph = buildArrowGraph(scope);

    // ─── dangling_arrow ───
    if (requested.has("dangling_arrow")) {
      for (const el of scope) {
        if (el.type !== "arrow") continue;
        const start = (el as { startBinding?: { elementId: string } | null })
          .startBinding;
        const end = (el as { endBinding?: { elementId: string } | null })
          .endBinding;
        const missing: string[] = [];
        if (!start) missing.push("tail");
        else if (!byId.has(start.elementId)) missing.push("tail → missing shape");
        if (!end) missing.push("head");
        else if (!byId.has(end.elementId)) missing.push("head → missing shape");
        if (missing.length > 0) {
          issues.push({
            kind: "dangling_arrow",
            shapeIds: [el.id],
            description: `Arrow ${el.id.slice(0, 6)} is not bound: ${missing.join(", ")}.`,
            severity: "warning",
          });
        }
      }
    }

    // ─── orphan ─── (only meaningful when there are ≥2 drawn shapes)
    if (requested.has("orphan") && drawn.length >= 2) {
      for (const el of drawn) {
        const inD = graph.inDegree.get(el.id) ?? 0;
        const outD = graph.outDegree.get(el.id) ?? 0;
        if (inD === 0 && outD === 0) {
          issues.push({
            kind: "orphan",
            shapeIds: [el.id],
            description: `${describeShape(el)} has no incoming or outgoing arrows.`,
            severity: "info",
          });
        }
      }
    }

    // ─── unlabeled ─── (geo shapes only; notes can be intentionally blank)
    if (requested.has("unlabeled")) {
      for (const el of drawn) {
        if (el.type !== "rectangle" && el.type !== "ellipse" && el.type !== "diamond") continue;
        const bound = (el as {
          boundElements?: readonly { id: string; type: string }[];
        }).boundElements;
        const labelEl = bound?.find((b) => b.type === "text");
        const labelText = labelEl
          ? (byId.get(labelEl.id) as { text?: string } | undefined)?.text?.trim()
          : "";
        if (!labelText) {
          issues.push({
            kind: "unlabeled",
            shapeIds: [el.id],
            description: `${el.type} ${el.id.slice(0, 6)} has no label.`,
            severity: "info",
          });
        }
      }
    }

    // ─── overlap ─── (drawn shapes only, skip frame-containment, skip bound text↔container)
    if (requested.has("overlap") && drawn.length >= 2) {
      const flagged = new Set<string>();
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const a = drawn[i];
          const b = drawn[j];
          // Skip when one contains the other via frame membership
          const aFrame = (a as { frameId?: string | null }).frameId;
          const bFrame = (b as { frameId?: string | null }).frameId;
          if (aFrame === b.id || bFrame === a.id) continue;
          // Skip when in the same frame and the user laid them out manually —
          // overlap inside a frame is a real issue too, so we keep this.
          const ra = rectFromElement(a);
          const rb = rectFromElement(b);
          if (rectsOverlap(ra, rb, -1)) {
            const key = [a.id, b.id].sort().join("§");
            if (flagged.has(key)) continue;
            flagged.add(key);
            issues.push({
              kind: "overlap",
              shapeIds: [a.id, b.id],
              description: `${describeShape(a)} overlaps ${describeShape(b)}.`,
              severity: "warning",
            });
          }
        }
      }
    }

    // ─── off_canvas ─── (nearest-neighbour distance > threshold)
    if (requested.has("off_canvas") && drawn.length >= 3) {
      const threshold = input.offCanvasThreshold ?? 800;
      const centres = drawn.map((el) => ({
        id: el.id,
        c: rectCentre(rectFromElement(el)),
      }));
      for (const me of centres) {
        let minDist = Infinity;
        for (const other of centres) {
          if (other.id === me.id) continue;
          const dx = me.c.x - other.c.x;
          const dy = me.c.y - other.c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        if (minDist > threshold) {
          const el = byId.get(me.id)!;
          issues.push({
            kind: "off_canvas",
            shapeIds: [me.id],
            description: `${describeShape(el)} is ${Math.round(minDist)}px from its nearest neighbour (threshold ${threshold}px).`,
            severity: "info",
          });
        }
      }
    }

    // ─── style_drift ─── (per-frame stroke colour outliers)
    if (requested.has("style_drift")) {
      // Group drawn shapes by frame.
      const byFrame = new Map<string, NonDeletedExcalidrawElement[]>();
      for (const el of drawn) {
        const fId = (el as { frameId?: string | null }).frameId ?? "__loose";
        if (!byFrame.has(fId)) byFrame.set(fId, []);
        byFrame.get(fId)!.push(el);
      }
      for (const [fId, group] of byFrame) {
        if (group.length < 4) continue; // not enough signal
        const counts = new Map<string, string[]>();
        for (const el of group) {
          const stroke = (el as { strokeColor?: string }).strokeColor ?? "";
          if (!counts.has(stroke)) counts.set(stroke, []);
          counts.get(stroke)!.push(el.id);
        }
        if (counts.size < 3) continue; // small palette, no drift
        // Flag colours used by exactly one shape inside a frame that has ≥3 colours.
        for (const [stroke, ids] of counts) {
          if (ids.length !== 1) continue;
          const where = fId === "__loose" ? "outside any frame" : `inside frame ${fId.slice(0, 6)}`;
          issues.push({
            kind: "style_drift",
            shapeIds: ids,
            description: `Stroke colour ${stroke || "(default)"} is used by exactly one shape ${where}; rest of the cluster uses a different palette.`,
            severity: "info",
          });
        }
      }
    }

    const byCategory: Record<string, number> = {};
    for (const issue of issues) {
      byCategory[issue.kind] = (byCategory[issue.kind] ?? 0) + 1;
    }

    return ok({
      issues,
      summary: { total: issues.length, byCategory },
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "analyze_canvas failed",
    );
  }
}

/* ─── explain_diagram ─── */

export interface ExplainDiagramInput {
  frameId?: string;
  verbose?: boolean;
}

export interface ExplainDiagramOutput {
  headline: string;
  sections: Array<{ title: string; body: string }>;
  stats: {
    shapeCount: number;
    arrowCount: number;
    frameCount: number;
    componentCount: number;
  };
}

export function executeExplainDiagram(
  api: ExcalidrawImperativeAPI,
  input: ExplainDiagramInput,
): ToolResult<ExplainDiagramOutput> {
  try {
    const all = api.getSceneElements();
    let scope: readonly NonDeletedExcalidrawElement[] = all;
    if (input.frameId) {
      const frame = all.find((e) => e.id === input.frameId);
      if (!frame) {
        return fail(
          "not_found",
          `Frame not found: ${input.frameId}`,
        );
      }
      scope = all.filter(
        (e) =>
          e.id === input.frameId ||
          (e as { frameId?: string | null }).frameId === input.frameId,
      );
    }

    const byId = new Map(scope.map((e) => [e.id, e]));
    const drawn = scope.filter(isDrawnShape);
    const arrows = scope.filter((e) => e.type === "arrow");
    const frames = scope.filter((e) => e.type === "frame");
    const graph = buildArrowGraph(scope);

    // Label lookup: a shape's bound text element, if any.
    const labelOf = (id: string): string => {
      const el = byId.get(id);
      if (!el) return id.slice(0, 6);
      const ownText = (el as { text?: string }).text;
      if (ownText && ownText.trim()) return ownText.trim();
      const bound = (el as {
        boundElements?: readonly { id: string; type: string }[];
      }).boundElements;
      const textRef = bound?.find((b) => b.type === "text");
      if (textRef) {
        const t = (byId.get(textRef.id) as { text?: string } | undefined)?.text;
        if (t && t.trim()) return t.trim();
      }
      return `${el.type} ${id.slice(0, 6)}`;
    };

    // Component analysis over drawn shapes.
    const drawnIds = drawn.map((e) => e.id);
    const components = connectedComponents(drawnIds, graph.neighbors);

    // For each component find sources (in=0, out>0) and sinks (out=0, in>0).
    const summarizeComponent = (ids: string[]): string => {
      if (ids.length === 1) {
        const el = byId.get(ids[0]);
        return el ? `Isolated: ${labelOf(ids[0])}.` : "";
      }
      const sources: string[] = [];
      const sinks: string[] = [];
      for (const id of ids) {
        const inD = graph.inDegree.get(id) ?? 0;
        const outD = graph.outDegree.get(id) ?? 0;
        if (inD === 0 && outD > 0) sources.push(labelOf(id));
        if (outD === 0 && inD > 0) sinks.push(labelOf(id));
      }
      const pieces: string[] = [];
      pieces.push(`${ids.length} shapes`);
      if (sources.length > 0) {
        pieces.push(`starts at ${sources.slice(0, 3).join(", ")}${sources.length > 3 ? "…" : ""}`);
      }
      if (sinks.length > 0) {
        pieces.push(`ends at ${sinks.slice(0, 3).join(", ")}${sinks.length > 3 ? "…" : ""}`);
      }
      return pieces.join("; ") + ".";
    };

    const sections: Array<{ title: string; body: string }> = [];

    // Per-frame sections.
    for (const frame of frames) {
      const inside = drawn.filter(
        (e) => (e as { frameId?: string | null }).frameId === frame.id,
      );
      const insideIds = new Set(inside.map((e) => e.id));
      const subComponents = components
        .map((c) => c.filter((id) => insideIds.has(id)))
        .filter((c) => c.length > 0);
      const title = (frame as { name?: string | null }).name?.trim() || `Frame ${frame.id.slice(0, 6)}`;
      const lines: string[] = [];
      lines.push(`${inside.length} shape(s) inside.`);
      if (subComponents.length > 0) {
        for (const sc of subComponents) {
          const desc = summarizeComponent(sc);
          if (desc) lines.push(desc);
        }
      }
      if (input.verbose) {
        const labels = inside.slice(0, 12).map((e) => labelOf(e.id));
        if (labels.length > 0) lines.push(`Includes: ${labels.join(", ")}${inside.length > 12 ? "…" : ""}.`);
      }
      sections.push({ title, body: lines.join(" ") });
    }

    // Loose shapes (not inside any frame).
    const looseDrawn = drawn.filter(
      (e) => !(e as { frameId?: string | null }).frameId,
    );
    if (looseDrawn.length > 0) {
      const looseIds = new Set(looseDrawn.map((e) => e.id));
      const looseComponents = components
        .map((c) => c.filter((id) => looseIds.has(id)))
        .filter((c) => c.length > 0);
      const lines: string[] = [];
      lines.push(`${looseDrawn.length} shape(s) outside any frame.`);
      for (const sc of looseComponents) {
        const desc = summarizeComponent(sc);
        if (desc) lines.push(desc);
      }
      sections.push({
        title: frames.length > 0 ? "Loose shapes" : "Diagram",
        body: lines.join(" "),
      });
    }

    // Headline.
    const headline = (() => {
      const parts: string[] = [];
      parts.push(
        `${drawn.length} shape${drawn.length === 1 ? "" : "s"}`,
      );
      parts.push(`${arrows.length} arrow${arrows.length === 1 ? "" : "s"}`);
      if (frames.length > 0) parts.push(`${frames.length} frame${frames.length === 1 ? "" : "s"}`);
      parts.push(`${components.length} component${components.length === 1 ? "" : "s"}`);
      const scopeStr = input.frameId ? "in this frame" : "on this board";
      return `${parts.join(", ")} ${scopeStr}.`;
    })();

    return ok({
      headline,
      sections,
      stats: {
        shapeCount: drawn.length,
        arrowCount: arrows.length,
        frameCount: frames.length,
        componentCount: components.length,
      },
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "explain_diagram failed",
    );
  }
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

/* ─── insert_template ──────────────────────────────────── *
 *
 * Each template is a `(originX, originY) => Skeleton[]` builder
 * whose ids are scoped to the skeleton (so `start: { id }` /
 * `end: { id }` binding works inside `convertToExcalidrawElements`).
 * After conversion we collect the real Excalidraw ids and
 * optionally wrap everything in a frame.
 *
 * Coordinates inside each template are LOCAL (starting at 0,0); the
 * caller translates by the resolved origin. Each template returns
 * a `size` so the placement code can centre it on the anchor.
 */

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0] extends
  | Array<infer T>
  | null
  ? T
  : never;

interface TemplateSpec {
  /** Local-space bbox of the whole cluster (used for centring). */
  width: number;
  height: number;
  /** Element skeletons translated by (originX, originY). */
  build(originX: number, originY: number): Skeleton[];
}

/** Resolve template/image placement anchor → top-left of content. */
function resolvePlacementOrigin(
  api: ExcalidrawImperativeAPI,
  anchor:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport"
    | "free_space"
    | undefined,
  contentW: number,
  contentH: number,
): { x: number; y: number } | { error: string } {
  const state = api.getAppState();
  const elements = api.getSceneElements();

  // Helper: centre a (w, h) content box on a centre point.
  const centreOn = (cx: number, cy: number) => ({
    x: cx - contentW / 2,
    y: cy - contentH / 2,
  });

  if (anchor === undefined || anchor === "viewport") {
    const c = viewportCentre(state);
    return centreOn(c.x, c.y);
  }
  if (anchor === "selection") {
    const elementsById = makeElementsById(elements);
    const sc = selectionCentre(state, elementsById);
    if (sc) return centreOn(sc.x, sc.y);
    const c = viewportCentre(state);
    return centreOn(c.x, c.y);
  }
  if (anchor === "free_space") {
    // Light reuse of find_free_space's spiral: anchor at viewport
    // centre, then push outward until we miss every drawn shape.
    const focal = viewportCentre(state);
    const gap = FREE_SPACE_DEFAULT_GAP;
    const obstacles: SceneRect[] = [];
    for (const el of elements) {
      if (el.type === "frame" || el.type === "magicframe") continue;
      if (el.type === "arrow") continue;
      if (
        el.type === "text" &&
        (el as ExcalidrawTextElement).containerId
      ) {
        continue;
      }
      obstacles.push(rectFromElement(el));
    }
    const baseStep = Math.max(
      FREE_SPACE_STEP_BASE,
      Math.round(Math.min(contentW, contentH) / 2),
    );
    const order: Array<"right" | "below" | "left" | "above"> = [
      "right",
      "below",
      "left",
      "above",
    ];
    const tryAt = (x: number, y: number) => {
      const cand: SceneRect = { x, y, w: contentW, h: contentH };
      return !obstacles.some((o) => rectsOverlap(cand, o, gap));
    };
    // Ring 0 — viewport centre, top-left adjusted.
    const initial = centreOn(focal.x, focal.y);
    if (tryAt(initial.x, initial.y)) return initial;
    for (let ring = 1; ring < FREE_SPACE_MAX_ATTEMPTS / order.length; ring++) {
      for (const side of order) {
        const offset = ring * baseStep;
        const c = (() => {
          switch (side) {
            case "right":
              return { x: focal.x + offset, y: focal.y };
            case "left":
              return { x: focal.x - offset, y: focal.y };
            case "below":
              return { x: focal.x, y: focal.y + offset };
            case "above":
              return { x: focal.x, y: focal.y - offset };
          }
        })();
        const tl = centreOn(c.x, c.y);
        if (tryAt(tl.x, tl.y)) return tl;
      }
    }
    return initial; // exhausted; place anyway
  }
  if ("shapeId" in anchor) {
    const el = elements.find((e) => e.id === anchor.shapeId);
    if (!el) {
      return {
        error: `Shape not found: ${anchor.shapeId}. Call find_shapes or query_canvas for current ids.`,
      };
    }
    const c = rectCentre(rectFromElement(el));
    return centreOn(c.x, c.y);
  }
  // {x, y} treated as the desired CENTRE — so the template lands
  // visually where the user pointed.
  return centreOn(anchor.x, anchor.y);
}

/* ─── template builders ─────────────────────────────────── *
 *
 * Coordinates are LOCAL (0..width, 0..height); the caller adds
 * the origin offset. Each builder uses skeleton-local ids of the
 * form `tpl-XX` so arrow `start: { id }` / `end: { id }` resolves
 * inside the same convertToExcalidrawElements pass.
 */

/** Sugar: a labelled rectangle with consistent default sizing. */
function tplBox(opts: {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  bg?: string;
  stroke?: string;
}): Skeleton {
  return {
    type: "rectangle",
    id: opts.id,
    x: opts.x,
    y: opts.y,
    width: opts.w ?? 180,
    height: opts.h ?? 80,
    strokeColor: opts.stroke ?? "#1e1e1e",
    backgroundColor: opts.bg ?? "transparent",
    fillStyle: opts.bg && opts.bg !== "transparent" ? "solid" : "hachure",
    label: { text: opts.label, fontSize: 16 },
  } as Skeleton;
}

/** Sugar: an arrow that binds to two skeleton ids by name. */
function tplArrow(opts: {
  id: string;
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  elbowed?: boolean;
}): Skeleton {
  const spec: Record<string, unknown> = {
    type: "arrow",
    id: opts.id,
    x: opts.fromX,
    y: opts.fromY,
    endArrowhead: "arrow",
    points: [
      [0, 0],
      [opts.toX - opts.fromX, opts.toY - opts.fromY],
    ],
    start: { id: opts.fromId },
    end: { id: opts.toId },
  };
  if (opts.label) spec.label = { text: opts.label, fontSize: 14 };
  if (opts.elbowed) spec.elbowed = true;
  return spec as Skeleton;
}

/** Auth flow: Client → Auth Service → User DB; session arrow back. */
function buildAuthFlowTemplate(): TemplateSpec {
  return {
    width: 700,
    height: 240,
    build: (ox, oy) => [
      tplBox({ id: "tpl-client", x: ox + 0, y: oy + 80, label: "Client" }),
      tplBox({
        id: "tpl-auth",
        x: ox + 260,
        y: oy + 80,
        label: "Auth Service",
      }),
      tplBox({ id: "tpl-db", x: ox + 520, y: oy + 80, label: "User DB" }),
      tplArrow({
        id: "tpl-a1",
        fromId: "tpl-client",
        toId: "tpl-auth",
        fromX: ox + 180,
        fromY: oy + 120,
        toX: ox + 260,
        toY: oy + 120,
        label: "login",
      }),
      tplArrow({
        id: "tpl-a2",
        fromId: "tpl-auth",
        toId: "tpl-db",
        fromX: ox + 440,
        fromY: oy + 120,
        toX: ox + 520,
        toY: oy + 120,
        label: "lookup",
      }),
      tplArrow({
        id: "tpl-a3",
        fromId: "tpl-auth",
        toId: "tpl-client",
        fromX: ox + 350,
        fromY: oy + 160,
        toX: ox + 90,
        toY: oy + 160,
        label: "session",
      }),
    ],
  };
}

/** Linear request lifecycle. */
function buildRequestLifecycleTemplate(): TemplateSpec {
  const labels = [
    "Client",
    "CDN",
    "Load Balancer",
    "API",
    "Service",
    "Database",
  ];
  const boxW = 160;
  const gap = 40;
  return {
    width: labels.length * boxW + (labels.length - 1) * gap,
    height: 100,
    build: (ox, oy) => {
      const els: Skeleton[] = [];
      labels.forEach((lbl, i) => {
        els.push(
          tplBox({
            id: `tpl-rl-${i}`,
            x: ox + i * (boxW + gap),
            y: oy + 10,
            w: boxW,
            h: 70,
            label: lbl,
          }),
        );
      });
      for (let i = 0; i < labels.length - 1; i++) {
        els.push(
          tplArrow({
            id: `tpl-rl-a${i}`,
            fromId: `tpl-rl-${i}`,
            toId: `tpl-rl-${i + 1}`,
            fromX: ox + i * (boxW + gap) + boxW,
            fromY: oy + 45,
            toX: ox + (i + 1) * (boxW + gap),
            toY: oy + 45,
          }),
        );
      }
      return els;
    },
  };
}

/** API Gateway → 3 services → shared DB + Cache. */
function buildMicroservicesTemplate(): TemplateSpec {
  return {
    width: 720,
    height: 400,
    build: (ox, oy) => {
      const els: Skeleton[] = [];
      els.push(
        tplBox({ id: "tpl-ms-gw", x: ox + 270, y: oy + 0, label: "API Gateway" }),
      );
      const services = ["Service A", "Service B", "Service C"];
      services.forEach((name, i) => {
        els.push(
          tplBox({
            id: `tpl-ms-s${i}`,
            x: ox + i * 240,
            y: oy + 160,
            label: name,
          }),
        );
        els.push(
          tplArrow({
            id: `tpl-ms-a${i}`,
            fromId: "tpl-ms-gw",
            toId: `tpl-ms-s${i}`,
            fromX: ox + 360,
            fromY: oy + 80,
            toX: ox + i * 240 + 90,
            toY: oy + 160,
            elbowed: true,
          }),
        );
      });
      els.push(
        tplBox({
          id: "tpl-ms-db",
          x: ox + 80,
          y: oy + 320,
          label: "Postgres",
        }),
        tplBox({
          id: "tpl-ms-cache",
          x: ox + 440,
          y: oy + 320,
          label: "Redis",
        }),
      );
      // Each service connects to DB and cache.
      services.forEach((_n, i) => {
        els.push(
          tplArrow({
            id: `tpl-ms-d${i}`,
            fromId: `tpl-ms-s${i}`,
            toId: "tpl-ms-db",
            fromX: ox + i * 240 + 90,
            fromY: oy + 240,
            toX: ox + 170,
            toY: oy + 320,
            elbowed: true,
          }),
          tplArrow({
            id: `tpl-ms-c${i}`,
            fromId: `tpl-ms-s${i}`,
            toId: "tpl-ms-cache",
            fromX: ox + i * 240 + 90,
            fromY: oy + 240,
            toX: ox + 530,
            toY: oy + 320,
            elbowed: true,
          }),
        );
      });
      return els;
    },
  };
}

/** Three-entity ERD. */
function buildErdTemplate(): TemplateSpec {
  return {
    width: 700,
    height: 260,
    build: (ox, oy) => [
      tplBox({
        id: "tpl-erd-user",
        x: ox + 0,
        y: oy + 90,
        w: 200,
        h: 100,
        label: "User\nid, email, name",
      }),
      tplBox({
        id: "tpl-erd-order",
        x: ox + 250,
        y: oy + 90,
        w: 200,
        h: 100,
        label: "Order\nid, user_id, total",
      }),
      tplBox({
        id: "tpl-erd-prod",
        x: ox + 500,
        y: oy + 90,
        w: 200,
        h: 100,
        label: "Product\nid, name, price",
      }),
      tplArrow({
        id: "tpl-erd-a1",
        fromId: "tpl-erd-user",
        toId: "tpl-erd-order",
        fromX: ox + 200,
        fromY: oy + 140,
        toX: ox + 250,
        toY: oy + 140,
        label: "places",
      }),
      tplArrow({
        id: "tpl-erd-a2",
        fromId: "tpl-erd-order",
        toId: "tpl-erd-prod",
        fromX: ox + 450,
        fromY: oy + 140,
        toX: ox + 500,
        toY: oy + 140,
        label: "contains",
      }),
    ],
  };
}

/** Sequence diagram skeleton: 4 actors + lifelines. */
function buildSequenceSkeletonTemplate(): TemplateSpec {
  const actors = ["Client", "API", "Service", "DB"];
  const colW = 180;
  const height = 360;
  return {
    width: actors.length * colW,
    height,
    build: (ox, oy) => {
      const els: Skeleton[] = [];
      actors.forEach((name, i) => {
        // Header
        els.push(
          tplBox({
            id: `tpl-seq-h${i}`,
            x: ox + i * colW + 30,
            y: oy + 0,
            w: 120,
            h: 50,
            label: name,
          }),
        );
        // Lifeline (vertical line as an arrow with no head, going down)
        els.push({
          type: "line",
          id: `tpl-seq-l${i}`,
          x: ox + i * colW + 90,
          y: oy + 50,
          width: 0,
          height: height - 50,
          strokeColor: "#999",
          strokeStyle: "dashed",
          points: [
            [0, 0],
            [0, height - 50],
          ],
        } as Skeleton);
      });
      return els;
    },
  };
}

/** MVP roadmap: 3 frames (Now / Next / Later) with placeholder cards. */
function buildMvpRoadmapTemplate(): TemplateSpec {
  const colW = 240;
  const colH = 360;
  const colGap = 40;
  const columns = ["Now", "Next", "Later"];
  return {
    width: columns.length * colW + (columns.length - 1) * colGap,
    height: colH + 40,
    build: (ox, oy) => {
      const els: Skeleton[] = [];
      columns.forEach((title, i) => {
        const cx = ox + i * (colW + colGap);
        // Column header
        els.push(
          tplBox({
            id: `tpl-rm-h${i}`,
            x: cx,
            y: oy,
            w: colW,
            h: 40,
            label: title,
            stroke: "#1e1e1e",
          }),
        );
        // Three placeholder cards per column.
        for (let j = 0; j < 3; j++) {
          els.push({
            type: "rectangle",
            id: `tpl-rm-${i}-${j}`,
            x: cx + 16,
            y: oy + 60 + j * 100,
            width: colW - 32,
            height: 80,
            strokeColor: "#888",
            backgroundColor: "#f0f0f0",
            fillStyle: "solid",
            label: { text: "—", fontSize: 14 },
          } as Skeleton);
        }
      });
      return els;
    },
  };
}

/** Retro 4-quadrant. */
function buildRetroQuadrantTemplate(): TemplateSpec {
  const cellW = 320;
  const cellH = 200;
  const titles = [
    "Went well",
    "Could improve",
    "Action items",
    "Questions",
  ];
  return {
    width: cellW * 2,
    height: cellH * 2,
    build: (ox, oy) => {
      const els: Skeleton[] = [];
      titles.forEach((title, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        els.push(
          tplBox({
            id: `tpl-retro-${idx}`,
            x: ox + col * cellW,
            y: oy + row * cellH,
            w: cellW,
            h: cellH,
            label: title,
          }),
        );
      });
      return els;
    },
  };
}

/** Decision tree: diamond + 3 outcome branches. */
function buildDecisionTreeTemplate(): TemplateSpec {
  return {
    width: 600,
    height: 320,
    build: (ox, oy) => [
      {
        type: "diamond",
        id: "tpl-dt-q",
        x: ox + 200,
        y: oy + 0,
        width: 200,
        height: 100,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        label: { text: "Decision?", fontSize: 16 },
      } as Skeleton,
      tplBox({
        id: "tpl-dt-a",
        x: ox + 0,
        y: oy + 220,
        label: "Option A",
      }),
      tplBox({
        id: "tpl-dt-b",
        x: ox + 210,
        y: oy + 220,
        label: "Option B",
      }),
      tplBox({
        id: "tpl-dt-c",
        x: ox + 420,
        y: oy + 220,
        label: "Option C",
      }),
      tplArrow({
        id: "tpl-dt-aa",
        fromId: "tpl-dt-q",
        toId: "tpl-dt-a",
        fromX: ox + 250,
        fromY: oy + 100,
        toX: ox + 90,
        toY: oy + 220,
        label: "yes",
      }),
      tplArrow({
        id: "tpl-dt-ab",
        fromId: "tpl-dt-q",
        toId: "tpl-dt-b",
        fromX: ox + 300,
        fromY: oy + 100,
        toX: ox + 300,
        toY: oy + 220,
        label: "maybe",
      }),
      tplArrow({
        id: "tpl-dt-ac",
        fromId: "tpl-dt-q",
        toId: "tpl-dt-c",
        fromX: ox + 350,
        fromY: oy + 100,
        toX: ox + 510,
        toY: oy + 220,
        label: "no",
      }),
    ],
  };
}

const TEMPLATE_REGISTRY: Record<
  | "auth_flow"
  | "request_lifecycle"
  | "microservices"
  | "erd"
  | "sequence_skeleton"
  | "mvp_roadmap"
  | "retro_quadrant"
  | "decision_tree",
  () => TemplateSpec
> = {
  auth_flow: buildAuthFlowTemplate,
  request_lifecycle: buildRequestLifecycleTemplate,
  microservices: buildMicroservicesTemplate,
  erd: buildErdTemplate,
  sequence_skeleton: buildSequenceSkeletonTemplate,
  mvp_roadmap: buildMvpRoadmapTemplate,
  retro_quadrant: buildRetroQuadrantTemplate,
  decision_tree: buildDecisionTreeTemplate,
};

export interface InsertTemplateInput {
  kind: keyof typeof TEMPLATE_REGISTRY;
  anchor?:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport"
    | "free_space";
  title?: string;
  idempotencyKey?: string;
}

export interface InsertTemplateOutput {
  kind: InsertTemplateInput["kind"];
  shapeIds: string[];
  frameId?: string;
  origin: { x: number; y: number };
}

export function executeInsertTemplate(
  api: ExcalidrawImperativeAPI,
  input: InsertTemplateInput,
): ToolResult<InsertTemplateOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const builder = TEMPLATE_REGISTRY[input.kind];
      if (!builder) {
        return fail(
          "invalid_input",
          `Unknown template kind: ${input.kind}.`,
          `Valid kinds: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}.`,
        );
      }
      const spec = builder();
      const placement = resolvePlacementOrigin(
        api,
        input.anchor,
        spec.width,
        spec.height,
      );
      if ("error" in placement) {
        return fail("not_found", placement.error);
      }

      const skeletons = spec.build(placement.x, placement.y);
      // Materialise — convertToExcalidrawElements resolves the
      // skeleton-local arrow `start: { id }` / `end: { id }`
      // bindings AND wires container ↔ bound-text labels in one
      // pass.
      const created = convertToExcalidrawElements(skeletons);

      let allCreated: OrderedExcalidrawElement[] = [...created];
      let frameId: string | undefined;

      // Optional frame wrapping: build a frame element that spans
      // the placed cluster, then patch each child element's
      // `frameId` to point at it.
      if (input.title) {
        const padding = 24;
        const headerH = 36;
        const fx = placement.x - padding;
        const fy = placement.y - padding - headerH;
        const fw = spec.width + padding * 2;
        const fh = spec.height + padding * 2 + headerH;
        const frame = convertToExcalidrawElements([
          {
            type: "frame",
            x: fx,
            y: fy,
            width: fw,
            height: fh,
            name: input.title,
          } as Skeleton,
        ])[0];
        if (frame) {
          frameId = frame.id;
          allCreated = [
            frame,
            ...created.map(
              (el) =>
                ({ ...el, frameId: frame.id }) as OrderedExcalidrawElement,
            ),
          ];
        }
      }

      const existing = api.getSceneElements();
      api.updateScene({
        elements: [...existing, ...allCreated],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      return ok({
        kind: input.kind,
        shapeIds: created.map((e) => e.id),
        frameId,
        origin: placement,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "insert_template failed",
      );
    }
  });
}

/* ─── add_image ─────────────────────────────────────────── *
 *
 * Native Excalidraw image element. Two input modes:
 *   - `svg`: agent-friendly. We base64-encode and produce a
 *     `data:image/svg+xml;base64,...` URL.
 *   - `dataUrl`: pre-encoded `data:image/...` URL.
 *
 * We register the file via `api.addFiles()` so the renderer can
 * resolve it, then push the image element onto the scene with
 * `status: "saved"` (the file is already in memory).
 */

export interface AddImageInput {
  svg?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  anchor?:
    | { shapeId: string }
    | { x: number; y: number }
    | "selection"
    | "viewport"
    | "free_space";
  idempotencyKey?: string;
}

export interface AddImageOutput {
  imageId: string;
  fileId: string;
  origin: { x: number; y: number };
}

/** UTF-8 safe base64 encoder. `btoa` chokes on multibyte chars. */
function utf8Btoa(input: string): string {
  if (typeof window === "undefined" || !window.btoa) {
    // Node fallback (smoke tests, SSR safety).
    return Buffer.from(input, "utf-8").toString("base64");
  }
  // Encode as UTF-8 first, then base64. The escape/unescape dance
  // is the canonical trick; it works because btoa wants binary
  // strings (each char in 0..255) and encodeURIComponent → %XX
  // gives us exactly that after unescape.
  return window.btoa(
    encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_m, p1) =>
      String.fromCharCode(parseInt(p1, 16)),
    ),
  );
}

export function executeAddImage(
  api: ExcalidrawImperativeAPI,
  input: AddImageInput,
): ToolResult<AddImageOutput> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      if (!input.svg && !input.dataUrl) {
        return fail(
          "invalid_input",
          "Provide either `svg` or `dataUrl`.",
        );
      }
      if (input.svg && input.dataUrl) {
        return fail(
          "invalid_input",
          "`svg` and `dataUrl` are mutually exclusive.",
        );
      }

      let dataUrl: string;
      let mimeType: string;
      if (input.svg) {
        const b64 = utf8Btoa(input.svg);
        dataUrl = `data:image/svg+xml;base64,${b64}`;
        mimeType = "image/svg+xml";
      } else {
        dataUrl = input.dataUrl!;
        // Pull mimeType out of the data URL prefix; fall back to png.
        const m = /^data:([^;]+);base64,/.exec(dataUrl);
        if (!m) {
          return fail(
            "invalid_input",
            "`dataUrl` must be a base64 data URL (`data:image/...;base64,...`).",
          );
        }
        mimeType = m[1];
      }

      const w = input.width ?? 240;
      const h = input.height ?? 240;
      const placement = resolvePlacementOrigin(api, input.anchor, w, h);
      if ("error" in placement) {
        return fail("not_found", placement.error);
      }

      const fileId = randomElementId();
      // `addFiles` registers the binary; Excalidraw will then
      // resolve `fileId` references on the image element from the
      // imageCache for rendering.
      api.addFiles([
        {
          id: fileId as unknown as Parameters<typeof api.addFiles>[0][number]["id"],
          dataURL: dataUrl as unknown as Parameters<
            typeof api.addFiles
          >[0][number]["dataURL"],
          mimeType:
            mimeType as unknown as Parameters<
              typeof api.addFiles
            >[0][number]["mimeType"],
          created: Date.now(),
        },
      ]);

      // Build the image element directly. convertToExcalidrawElements
      // doesn't handle the image-element flow because it expects a
      // pre-resolved file. We mint a fully-fleshed element with the
      // same defaults Excalidraw uses internally.
      const imageId = randomElementId();
      const imageEl: Record<string, unknown> = {
        type: "image",
        id: imageId,
        x: placement.x,
        y: placement.y,
        width: w,
        height: h,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: null,
        roundness: null,
        seed: Math.floor(Math.random() * 0x7fffffff),
        version: 1,
        versionNonce: Math.floor(Math.random() * 0x7fffffff),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        customData: undefined,
        fileId,
        status: "saved",
        scale: [1, 1],
        crop: null,
      };

      const existing = api.getSceneElements();
      api.updateScene({
        elements: [...existing, imageEl as unknown as ExcalidrawElement],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      return ok({
        imageId,
        fileId,
        origin: placement,
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_image failed",
      );
    }
  });
}

/* ─── screenshot_canvas ──────────────────────────────── */

export interface ScreenshotCanvasInput {
  shapeIds?: string[];
  frameId?: string;
  padding?: number;
  scale?: number;
}

export interface ScreenshotCanvasOutput {
  dataUrl: string;
  width: number;
  height: number;
  scale: number;
  sizeBytes: number;
  shapeCount: number;
}

const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
const SCREENSHOT_FALLBACK_SCALES = [1, 0.75, 0.5, 0.35, 0.25] as const;

function estimateDataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.length - (i + 1);
  return Math.ceil((b64 * 3) / 4);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export async function executeScreenshotCanvas(
  api: ExcalidrawImperativeAPI,
  input: ScreenshotCanvasInput,
): Promise<ToolResult<ScreenshotCanvasOutput>> {
  const all = api.getSceneElements();
  if (all.length === 0) {
    return fail(
      "preconditions_failed",
      "Canvas is empty — nothing to screenshot.",
      "Add shapes first, then call screenshot_canvas again.",
    );
  }

  let target: readonly NonDeletedExcalidrawElement[] = all;
  if (input.frameId) {
    const frame = all.find((el) => el.id === input.frameId);
    if (!frame) {
      return fail(
        "not_found",
        `Frame "${input.frameId}" not found.`,
        "Call query_canvas to refresh ids.",
      );
    }
    target = all.filter(
      (el) => el.id === input.frameId || el.frameId === input.frameId,
    );
  } else if (input.shapeIds?.length) {
    const wanted = new Set(input.shapeIds);
    target = all.filter((el) => wanted.has(el.id));
    if (target.length === 0) {
      return fail(
        "not_found",
        `None of the supplied shapeIds matched the current scene.`,
        "Call query_canvas / find_shapes to refresh ids.",
      );
    }
  }

  const appState = api.getAppState();
  const files = api.getFiles();

  let mod: typeof import("@excalidraw/excalidraw");
  try {
    mod = await import("@excalidraw/excalidraw");
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "excalidraw export unavailable",
    );
  }

  const padding = Math.max(0, Math.min(input.padding ?? 24, 200));
  const requested = input.scale ?? 1;
  const scales = SCREENSHOT_FALLBACK_SCALES.filter((s) => s <= requested);
  if (scales.length === 0) scales.push(0.25);

  let lastErr: unknown = null;
  for (const scale of scales) {
    try {
      const blob = await mod.exportToBlob({
        elements: target as readonly NonDeletedExcalidrawElement[],
        appState: {
          ...appState,
          exportBackground: true,
          exportWithDarkMode: appState.theme === "dark",
        } as Partial<AppState>,
        files,
        mimeType: "image/png",
        exportPadding: padding,
        getDimensions: (w: number, h: number) => ({
          width: w,
          height: h,
          scale,
        }),
      });
      const dataUrl = await blobToDataUrl(blob);
      const sizeBytes = estimateDataUrlBytes(dataUrl);
      if (sizeBytes <= SCREENSHOT_MAX_BYTES) {
        return ok({
          dataUrl,
          width: Math.round((blob as Blob & { width?: number }).width ?? 0),
          height: Math.round((blob as Blob & { height?: number }).height ?? 0),
          scale,
          sizeBytes,
          shapeCount: target.length,
        });
      }
      lastErr = `scale ${scale} produced ${sizeBytes} bytes (> ${SCREENSHOT_MAX_BYTES})`;
    } catch (err) {
      lastErr = err;
    }
  }

  return fail(
    "size_limit",
    lastErr instanceof Error
      ? lastErr.message
      : "PNG export exceeded the 2 MB budget at every fallback scale.",
    "Narrow the capture via `shapeIds` / `frameId`, or shrink the diagram before retrying.",
  );
}
