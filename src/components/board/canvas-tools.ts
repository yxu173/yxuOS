"use client";

import {
  createBindingId,
  createShapeId,
  renderPlaintextFromRichText,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
} from "tldraw";

import {
  fail,
  ok,
  withIdempotency,
  withIdempotencyAsync,
  type ToolResult,
} from "@/lib/tool-result";

import { validateMermaid } from "./mermaid";

/* ─── Types mirrored from src/mastra/tools/canvas.ts ─── */

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

/* ─── helpers ─── */

const TEXT_PREVIEW_LIMIT = 200;
const SAMPLE_LABEL_LIMIT = 10;
const SAMPLE_LABEL_TEXT_LIMIT = 60;
const QUERY_DEFAULT_LIMIT = 100;
const FIND_DEFAULT_LIMIT = 20;

function truncate(value: string | undefined, limit = TEXT_PREVIEW_LIMIT) {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function getShapeText(editor: Editor, shape: TLShape): string | undefined {
  const props = shape.props as Record<string, unknown>;
  if (typeof props.markdown === "string") return truncate(props.markdown);
  if (typeof props.mermaid === "string") return truncate(props.mermaid);
  if (typeof props.text === "string" && props.text.trim()) {
    return truncate(props.text);
  }
  if (typeof props.name === "string" && props.name.trim()) {
    return truncate(props.name);
  }
  if (props.richText) {
    try {
      const plain = renderPlaintextFromRichText(
        editor,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        props.richText as any,
      );
      return truncate(plain);
    } catch {
      // fall through
    }
  }
  return undefined;
}

function shapeToRow(editor: Editor, shape: TLShape): ShapeRow {
  const props = shape.props as Record<string, unknown>;
  const w = typeof props.w === "number" ? (props.w as number) : undefined;
  const h = typeof props.h === "number" ? (props.h as number) : undefined;
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    w,
    h,
    text: getShapeText(editor, shape),
  };
}

function intersectsViewport(
  editor: Editor,
  shape: TLShape,
): boolean {
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return false;
  const vp = editor.getViewportPageBounds();
  return !(
    bounds.maxX < vp.minX ||
    bounds.minX > vp.maxX ||
    bounds.maxY < vp.minY ||
    bounds.minY > vp.maxY
  );
}

function buildSummary(
  editor: Editor,
  shapes: TLShape[],
): QueryCanvasOutput["summary"] {
  const byType: Record<string, number> = {};
  const sampleLabels: string[] = [];
  for (const shape of shapes) {
    byType[shape.type] = (byType[shape.type] ?? 0) + 1;
    if (sampleLabels.length < SAMPLE_LABEL_LIMIT) {
      const text = getShapeText(editor, shape);
      if (text) {
        sampleLabels.push(
          text.length > SAMPLE_LABEL_TEXT_LIMIT
            ? `${text.slice(0, SAMPLE_LABEL_TEXT_LIMIT)}…`
            : text,
        );
      }
    }
  }
  return { totalShapes: shapes.length, byType, sampleLabels };
}

/* ─── query_canvas ─────────────────────────────────────── */

export function executeQueryCanvas(
  editor: Editor,
  input: QueryCanvasInput = {},
): ToolResult<QueryCanvasOutput> {
  try {
    const allShapes = editor.getCurrentPageShapes();
    const summary = buildSummary(editor, allShapes);

    const camera = editor.getCamera();
    const viewport = editor.getViewportPageBounds();
    const selectedShapeIds = editor.getSelectedShapeIds();

    if (input.summaryOnly) {
      return ok({
        summary,
        returned: 0,
        truncated: false,
        nextCursor: null,
        camera: { x: camera.x, y: camera.y, z: camera.z },
        viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        selectedShapeIds,
      });
    }

    const filtered = input.viewportOnly
      ? allShapes.filter((shape) => intersectsViewport(editor, shape))
      : allShapes;

    const limit = input.limit ?? QUERY_DEFAULT_LIMIT;
    const start = input.cursor ? parseCursor(input.cursor) : 0;
    const slice = filtered.slice(start, start + limit);
    const truncated = start + slice.length < filtered.length;

    return ok({
      summary,
      shapes: slice.map((shape) => shapeToRow(editor, shape)),
      returned: slice.length,
      truncated,
      nextCursor: truncated ? encodeCursor(start + slice.length) : null,
      camera: { x: camera.x, y: camera.y, z: camera.z },
      viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
      selectedShapeIds,
    });
  } catch (err) {
    return fail(
      "internal",
      err instanceof Error ? err.message : "query_canvas failed",
    );
  }
}

function parseCursor(cursor: string): number {
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeCursor(index: number): string {
  return String(index);
}

/* ─── find_shapes ──────────────────────────────────────── */

export function executeFindShapes(
  editor: Editor,
  input: FindShapesInput,
): ToolResult<FindShapesOutput> {
  try {
    const limit = input.limit ?? FIND_DEFAULT_LIMIT;
    const all = editor.getCurrentPageShapes();
    const lowered = input.query?.toLowerCase();

    const allMatches: TLShape[] = [];
    for (const shape of all) {
      if (input.type && shape.type !== input.type) continue;
      if (input.viewportOnly && !intersectsViewport(editor, shape)) continue;
      if (lowered) {
        const text = getShapeText(editor, shape)?.toLowerCase();
        if (!text || !text.includes(lowered)) continue;
      }
      allMatches.push(shape);
    }

    const truncated = allMatches.length > limit;
    const matches = allMatches
      .slice(0, limit)
      .map((shape) => shapeToRow(editor, shape));

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

/* ─── add_shapes ───────────────────────────────────────── */

const ARROW_FALLBACK_LENGTH = 200;

function isShapeRef(value: unknown): value is ShapeRefInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "shapeId" in value &&
    typeof (value as ShapeRefInput).shapeId === "string"
  );
}

function resolveTerminalPoint(
  editor: Editor,
  terminal: PointInput | ShapeRefInput | undefined,
  fallback: PointInput,
): PointInput {
  if (!terminal) return fallback;
  if (isShapeRef(terminal)) {
    const shape = editor.getShape(terminal.shapeId as TLShapeId);
    if (!shape) return fallback;
    const bounds = editor.getShapePageBounds(shape);
    if (!bounds) return { x: shape.x, y: shape.y };
    return { x: bounds.center.x, y: bounds.center.y };
  }
  return { x: terminal.x, y: terminal.y };
}

export function executeAddShapes(
  editor: Editor,
  input: { shapes: ShapeInput[]; idempotencyKey?: string },
): ToolResult<{ createdShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    try {
      const ids: TLShapeId[] = [];
      const bindings: Array<{
        arrowId: TLShapeId;
        terminal: "start" | "end";
        targetShapeId: TLShapeId;
      }> = [];

      editor.run(() => {
        for (const spec of input.shapes) {
          const id = createShapeId();
          ids.push(id);

          switch (spec.type) {
            case "geo": {
              editor.createShape({
                id,
                type: "geo",
                x: spec.x ?? 0,
                y: spec.y ?? 0,
                props: {
                  geo: (spec.geo as never) ?? ("rectangle" as never),
                  w: spec.w ?? 200,
                  h: spec.h ?? 120,
                  color: (spec.color as never) ?? ("black" as never),
                  fill: (spec.fill as never) ?? ("none" as never),
                  size: (spec.size as never) ?? ("m" as never),
                  ...(spec.text ? { richText: toRichText(spec.text) } : {}),
                },
              });
              break;
            }
            case "text": {
              editor.createShape({
                id,
                type: "text",
                x: spec.x ?? 0,
                y: spec.y ?? 0,
                props: {
                  richText: toRichText(spec.text ?? ""),
                  color: (spec.color as never) ?? ("black" as never),
                  size: (spec.size as never) ?? ("m" as never),
                },
              });
              break;
            }
            case "note": {
              editor.createShape({
                id,
                type: "note",
                x: spec.x ?? 0,
                y: spec.y ?? 0,
                props: {
                  richText: toRichText(spec.text ?? ""),
                  color: (spec.color as never) ?? ("yellow" as never),
                  size: (spec.size as never) ?? ("m" as never),
                },
              });
              break;
            }
            case "frame": {
              editor.createShape({
                id,
                type: "frame",
                x: spec.x ?? 0,
                y: spec.y ?? 0,
                props: {
                  w: spec.w ?? 400,
                  h: spec.h ?? 300,
                  ...(spec.text ? { name: spec.text } : {}),
                },
              });
              break;
            }
            case "arrow": {
              const fromX = spec.x ?? 0;
              const fromY = spec.y ?? 0;
              const start = resolveTerminalPoint(editor, spec.start, {
                x: fromX,
                y: fromY,
              });
              const end = resolveTerminalPoint(editor, spec.end, {
                x: start.x + ARROW_FALLBACK_LENGTH,
                y: start.y,
              });
              editor.createShape({
                id,
                type: "arrow",
                x: start.x,
                y: start.y,
                props: {
                  color: (spec.color as never) ?? ("black" as never),
                  size: (spec.size as never) ?? ("m" as never),
                  start: { x: 0, y: 0 },
                  end: { x: end.x - start.x, y: end.y - start.y },
                  ...(spec.text ? { richText: toRichText(spec.text) } : {}),
                },
              });
              if (isShapeRef(spec.start)) {
                bindings.push({
                  arrowId: id,
                  terminal: "start",
                  targetShapeId: spec.start.shapeId as TLShapeId,
                });
              }
              if (isShapeRef(spec.end)) {
                bindings.push({
                  arrowId: id,
                  terminal: "end",
                  targetShapeId: spec.end.shapeId as TLShapeId,
                });
              }
              break;
            }
            default: {
              editor.createShape({
                id,
                type: "geo",
                x: spec.x ?? 0,
                y: spec.y ?? 0,
                props: {
                  geo: "rectangle" as never,
                  w: 120,
                  h: 60,
                  color: "red" as never,
                  fill: "none" as never,
                  size: "m" as never,
                  richText: toRichText(`unknown:${spec.type}`),
                },
              });
            }
          }
        }

        const validBindings = bindings.filter((b) =>
          editor.getShape(b.targetShapeId),
        );
        if (validBindings.length > 0) {
          editor.createBindings(
            validBindings.map((b) => ({
              id: createBindingId(),
              type: "arrow",
              fromId: b.arrowId,
              toId: b.targetShapeId,
              props: {
                terminal: b.terminal,
                normalizedAnchor: { x: 0.5, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
            })),
          );
        }
      });

      return ok({ createdShapeIds: ids });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_shapes failed",
      );
    }
  });
}

/* ─── connect_shapes ───────────────────────────────────── */

export function executeConnectShapes(
  editor: Editor,
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
    const from = editor.getShape(input.fromId as TLShapeId);
    const to = editor.getShape(input.toId as TLShapeId);
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

    const fromBounds = editor.getShapePageBounds(from);
    const toBounds = editor.getShapePageBounds(to);
    if (!fromBounds || !toBounds) {
      return fail(
        "preconditions_failed",
        "Couldn't compute bounds for one of the shapes.",
        "Try `add_shapes` with explicit start/end points.",
      );
    }

    const startPt = { x: fromBounds.center.x, y: fromBounds.center.y };
    const endPt = { x: toBounds.center.x, y: toBounds.center.y };
    const arrowId = createShapeId();

    try {
      editor.run(() => {
        editor.createShape({
          id: arrowId,
          type: "arrow",
          x: startPt.x,
          y: startPt.y,
          props: {
            color: (input.color as never) ?? ("black" as never),
            size: (input.size as never) ?? ("m" as never),
            start: { x: 0, y: 0 },
            end: { x: endPt.x - startPt.x, y: endPt.y - startPt.y },
            ...(input.label ? { richText: toRichText(input.label) } : {}),
          },
        });
        editor.createBindings([
          {
            id: createBindingId(),
            type: "arrow",
            fromId: arrowId,
            toId: from.id,
            props: {
              terminal: "start",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isExact: false,
              isPrecise: false,
            },
          },
          {
            id: createBindingId(),
            type: "arrow",
            fromId: arrowId,
            toId: to.id,
            props: {
              terminal: "end",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isExact: false,
              isPrecise: false,
            },
          },
        ]);
      });
      return ok({ arrowId });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "connect_shapes failed",
      );
    }
  });
}

/* ─── align_shapes / distribute_shapes ─────────────────── */

export function executeAlignShapes(
  editor: Editor,
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
    const ids = input.shapeIds.map((id) => id as TLShapeId);
    const present = ids.filter((id) => Boolean(editor.getShape(id)));
    const missing = ids.filter((id) => !editor.getShape(id));
    if (present.length < 2) {
      return fail(
        "not_found",
        `Need at least 2 valid shape ids. Missing: ${missing.join(", ") || "(none)"}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }
    try {
      editor.alignShapes(present, input.operation);
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

export function executeDistributeShapes(
  editor: Editor,
  input: {
    shapeIds: string[];
    axis: "horizontal" | "vertical";
    idempotencyKey?: string;
  },
): ToolResult<{ distributedShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const ids = input.shapeIds.map((id) => id as TLShapeId);
    const present = ids.filter((id) => Boolean(editor.getShape(id)));
    const missing = ids.filter((id) => !editor.getShape(id));
    if (present.length < 3) {
      return fail(
        "not_found",
        `Need at least 3 valid shape ids. Missing: ${missing.join(", ") || "(none)"}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }
    try {
      editor.distributeShapes(present, input.axis);
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
  editor: Editor,
  input: {
    shapeIds: string[];
    title: string;
    padding?: number;
    idempotencyKey?: string;
  },
): ToolResult<{ frameId: string; framedShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const ids = input.shapeIds.map((id) => id as TLShapeId);
    const present = ids.filter((id) => Boolean(editor.getShape(id)));
    const missing = ids.filter((id) => !editor.getShape(id));
    if (present.length === 0) {
      return fail(
        "not_found",
        `None of those shapes exist: ${input.shapeIds.join(", ")}.`,
        "Call `find_shapes` or `query_canvas` for current ids.",
      );
    }

    const padding = input.padding ?? 32;

    // Compute the union bounds in page space.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of present) {
      const shape = editor.getShape(id);
      if (!shape) continue;
      const bounds = editor.getShapePageBounds(shape);
      if (!bounds) continue;
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }
    if (!Number.isFinite(minX)) {
      return fail(
        "preconditions_failed",
        "Couldn't compute bounds for those shapes.",
      );
    }

    const frameId = createShapeId();
    try {
      editor.run(() => {
        editor.createShape({
          id: frameId,
          type: "frame",
          x: minX - padding,
          y: minY - padding,
          props: {
            w: maxX - minX + padding * 2,
            h: maxY - minY + padding * 2,
            name: input.title,
          },
        });
        // Reparent the contained shapes INTO the frame so dragging the
        // frame moves the group.
        editor.reparentShapes(present, frameId);
      });
      const warnings =
        missing.length > 0
          ? [`Skipped missing shapes: ${missing.join(", ")}`]
          : undefined;
      return ok({ frameId, framedShapeIds: present }, warnings);
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "group_into_frame failed",
      );
    }
  });
}

/* ─── add_markdown_card / add_mermaid_card ─────────────── */

export function executeAddMarkdownCard(
  editor: Editor,
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
      const id = createShapeId();
      editor.createShape({
        id,
        type: "markdown-card",
        x: input.x,
        y: input.y,
        props: { w: input.w, h: input.h, markdown: input.markdown },
      });
      return ok({ shapeId: id });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "add_markdown_card failed",
      );
    }
  });
}

export async function executeAddMermaidCard(
  editor: Editor,
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
    // Validate FIRST. On failure return a structured envelope — the agent
    // reads `error.code === 'validation_failed'` and retries with fixes.
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
      const id = createShapeId();
      editor.createShape({
        id,
        type: "mermaid-card",
        x: input.x,
        y: input.y,
        props: {
          w: input.w,
          h: input.h,
          mermaid: input.mermaid,
          kind: input.kind,
        },
      });
      return ok({ shapeId: id });
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

function buildPropsPatch(
  type: string,
  spec: ShapeUpdateInput,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  switch (type) {
    case "geo":
      if (spec.w !== undefined) props.w = spec.w;
      if (spec.h !== undefined) props.h = spec.h;
      if (spec.color) props.color = spec.color;
      if (spec.fill) props.fill = spec.fill;
      if (spec.size) props.size = spec.size;
      if (spec.text !== undefined) props.richText = toRichText(spec.text);
      break;
    case "text":
      if (spec.color) props.color = spec.color;
      if (spec.size) props.size = spec.size;
      if (spec.text !== undefined) props.richText = toRichText(spec.text);
      break;
    case "note":
      if (spec.color) props.color = spec.color;
      if (spec.size) props.size = spec.size;
      if (spec.text !== undefined) props.richText = toRichText(spec.text);
      break;
    case "frame":
      if (spec.w !== undefined) props.w = spec.w;
      if (spec.h !== undefined) props.h = spec.h;
      if (spec.text !== undefined) props.name = spec.text;
      break;
    case "arrow":
      if (spec.color) props.color = spec.color;
      if (spec.size) props.size = spec.size;
      if (spec.text !== undefined) props.richText = toRichText(spec.text);
      break;
    default:
      if (spec.w !== undefined) props.w = spec.w;
      if (spec.h !== undefined) props.h = spec.h;
      if (spec.text !== undefined) props.text = spec.text;
      break;
  }

  return props;
}

export function executeUpdateShapes(
  editor: Editor,
  input: { shapes: ShapeUpdateInput[]; idempotencyKey?: string },
): ToolResult<{ updatedShapeIds: string[]; missingShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const updated: string[] = [];
    const missing: string[] = [];

    try {
      editor.run(() => {
        for (const spec of input.shapes) {
          const shape = editor.getShape(spec.id as TLShapeId);
          if (!shape) {
            missing.push(spec.id);
            continue;
          }
          const propsPatch = buildPropsPatch(shape.type, spec);
          const update: {
            id: TLShapeId;
            type: string;
            x?: number;
            y?: number;
            props?: Record<string, unknown>;
          } = { id: shape.id, type: shape.type };
          if (spec.x !== undefined) update.x = spec.x;
          if (spec.y !== undefined) update.y = spec.y;
          if (Object.keys(propsPatch).length > 0) update.props = propsPatch;
          if (
            update.x !== undefined ||
            update.y !== undefined ||
            update.props !== undefined
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            editor.updateShape(update as any);
            updated.push(shape.id);
          }
        }
      });
    } catch (err) {
      return fail(
        "internal",
        err instanceof Error ? err.message : "update_shapes failed",
      );
    }

    if (updated.length === 0 && missing.length > 0) {
      return fail(
        "not_found",
        `Couldn't find any of the ${missing.length} requested shape(s). Examples: ${missing.slice(0, 3).join(", ")}.`,
        "Call `query_canvas` or `find_shapes` to refresh ids.",
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

/* ─── delete_shapes ────────────────────────────────────── */

export function executeDeleteShapes(
  editor: Editor,
  input: { shapeIds: string[]; idempotencyKey?: string },
): ToolResult<{ deletedShapeIds: string[]; missingShapeIds: string[] }> {
  return withIdempotency(input.idempotencyKey, () => {
    const ids = input.shapeIds.map((id) => id as TLShapeId);
    const existing = ids.filter((id) => Boolean(editor.getShape(id)));
    const missing = ids.filter((id) => !editor.getShape(id));
    if (existing.length === 0) {
      return fail(
        "not_found",
        "None of those shape ids exist on the canvas.",
        "Call `query_canvas` to refresh.",
      );
    }
    try {
      editor.deleteShapes(existing);
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
    return ok(
      { deletedShapeIds: existing as string[], missingShapeIds: missing as string[] },
      warnings,
    );
  });
}
