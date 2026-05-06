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

export interface QueryCanvasOutput {
  shapes: Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    text?: string;
  }>;
  camera: { x: number; y: number; z: number };
  viewport: { x: number; y: number; w: number; h: number };
  selectedShapeIds: string[];
}

/* ─── helpers ─── */

const TEXT_PREVIEW_LIMIT = 200;

function truncate(value: string | undefined, limit = TEXT_PREVIEW_LIMIT) {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function getShapeText(editor: Editor, shape: TLShape): string | undefined {
  const props = shape.props as Record<string, unknown>;
  if (typeof props.markdown === "string") {
    return truncate(props.markdown);
  }
  if (typeof props.mermaid === "string") {
    return truncate(props.mermaid);
  }
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

/* ─── tool implementations ─── */

export function executeQueryCanvas(editor: Editor): QueryCanvasOutput {
  const shapes = editor.getCurrentPageShapes().map((shape) => {
    const props = shape.props as Record<string, unknown>;
    const w =
      typeof props.w === "number" ? (props.w as number) : undefined;
    const h =
      typeof props.h === "number" ? (props.h as number) : undefined;
    return {
      id: shape.id,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      w,
      h,
      text: getShapeText(editor, shape),
    };
  });

  const camera = editor.getCamera();
  const viewport = editor.getViewportPageBounds();

  return {
    shapes,
    camera: { x: camera.x, y: camera.y, z: camera.z },
    viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
    selectedShapeIds: editor.getSelectedShapeIds(),
  };
}

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
  input: { shapes: ShapeInput[] },
): { createdShapeIds: string[] } {
  const ids: TLShapeId[] = [];
  // Bindings to create AFTER all shapes — so an arrow can bind to a shape
  // that's also part of this batch.
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
              ...(spec.text
                ? { richText: toRichText(spec.text) }
                : {}),
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
              ...(spec.text
                ? { richText: toRichText(spec.text) }
                : {}),
            },
          });
          // Queue arrow→shape bindings so dragging the bound shapes
          // moves the arrow with them.
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
          // Unknown type — drop a small placeholder rectangle so the agent
          // gets a created id back rather than a silent failure.
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

    // Now wire up arrow→shape bindings. Skip any whose target shape
    // doesn't exist in the editor (was dropped, never created, etc.).
    const validBindings = bindings.filter((binding) =>
      editor.getShape(binding.targetShapeId),
    );
    if (validBindings.length > 0) {
      editor.createBindings(
        validBindings.map((binding) => ({
          id: createBindingId(),
          type: "arrow",
          fromId: binding.arrowId,
          toId: binding.targetShapeId,
          props: {
            terminal: binding.terminal,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: false,
          },
        })),
      );
    }
  });

  return { createdShapeIds: ids };
}

export function executeAddMarkdownCard(
  editor: Editor,
  input: { x: number; y: number; w: number; h: number; markdown: string },
): { shapeId: string } {
  const id = createShapeId();
  editor.createShape({
    id,
    type: "markdown-card",
    x: input.x,
    y: input.y,
    props: {
      w: input.w,
      h: input.h,
      markdown: input.markdown,
    },
  });
  return { shapeId: id };
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
  },
): Promise<{ shapeId: string }> {
  // Validate the source FIRST. If parsing throws we propagate the error to
  // the agent (state: "output-error") instead of silently dropping a broken
  // card on the canvas — the agent can then retry with corrected syntax.
  await validateMermaid(input.mermaid);

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
  return { shapeId: id };
}
