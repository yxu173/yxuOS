import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Canvas tools. None of them define an `execute` function — they're
 * client-side tools. The server (Mastra agent) advertises them to the
 * model with `description + inputSchema` only; the live tldraw editor in
 * the browser actually executes them via `useChat`'s `onToolCall`.
 *
 * Using `string` for shape `type`s instead of strict literals keeps the
 * tool input wide enough for the model to be flexible while still letting
 * the client ignore unknown values.
 */

const positionSchema = z.object({
  x: z.number().describe("X coordinate in page space (not screen pixels)."),
  y: z.number().describe("Y coordinate in page space."),
});

// Shape input — what the model emits per shape it wants to draw.
// Mirrors a tldraw shape partial closely so the client can pass it
// almost verbatim into editor.createShapes.
const shapeInputSchema = z.object({
  type: z
    .enum(["geo", "arrow", "text", "note", "frame"])
    .describe(
      "tldraw shape type. `geo` covers rectangle/ellipse/diamond/etc. (set props.geo). `arrow` connects two points or shape ids. `text` is a label. `note` is a sticky note. `frame` groups shapes with a title.",
    ),
  x: z
    .number()
    .optional()
    .describe("Page-space X. For `arrow`, ignored — use `start`/`end`."),
  y: z.number().optional(),
  // geo / frame extras
  geo: z
    .enum([
      "rectangle",
      "ellipse",
      "diamond",
      "triangle",
      "rhombus",
      "trapezoid",
      "hexagon",
      "octagon",
      "star",
      "cloud",
      "x-box",
      "check-box",
      "oval",
    ])
    .optional()
    .describe("Sub-type for `geo` shapes. Defaults to rectangle."),
  w: z.number().optional().describe("Width for box-like shapes."),
  h: z.number().optional().describe("Height for box-like shapes."),
  text: z
    .string()
    .optional()
    .describe(
      "Label inside a geo shape, the contents of a text/note shape, or the frame title.",
    ),
  color: z
    .enum([
      "black",
      "grey",
      "blue",
      "green",
      "red",
      "violet",
      "orange",
      "yellow",
      "light-blue",
      "light-green",
      "light-red",
      "light-violet",
    ])
    .optional()
    .describe("Stroke / fill colour for geo / arrow / note."),
  fill: z
    .enum(["none", "semi", "solid", "pattern"])
    .optional()
    .describe("Fill style for geo shapes. Defaults to none (just outline)."),
  size: z
    .enum(["s", "m", "l", "xl"])
    .optional()
    .describe("Size preset for the stroke / text."),
  // arrow extras
  start: z
    .union([positionSchema, z.object({ shapeId: z.string() })])
    .optional()
    .describe(
      "Arrow start anchor — either an absolute page-space point or { shapeId } to bind to an existing shape.",
    ),
  end: z
    .union([positionSchema, z.object({ shapeId: z.string() })])
    .optional(),
});

export const queryCanvasTool = createTool({
  id: "query_canvas",
  description:
    "Read what is currently on the whiteboard. Always call this BEFORE adding new shapes if you need to position them relative to existing content. Returns the current shapes (with bounds and any text labels), the visible viewport, the camera, and which shapes the user has selected.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    shapes: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number().optional(),
        h: z.number().optional(),
        text: z.string().optional(),
      }),
    ),
    camera: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    viewport: z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }),
    selectedShapeIds: z.array(z.string()),
  }),
});

export const addShapesTool = createTool({
  id: "add_shapes",
  description:
    "Bulk-create one or more native tldraw shapes (hand-drawn rectangles, ellipses, arrows, text, sticky notes, frames). Use this for diagrams composed of geometric primitives. Coordinates are in page space — call `query_canvas` first if you need to place things relative to existing content.",
  inputSchema: z.object({
    shapes: z
      .array(shapeInputSchema)
      .min(1)
      .describe("Array of shape descriptions to create in one batch."),
  }),
  outputSchema: z.object({
    createdShapeIds: z.array(z.string()),
  }),
});

export const addMarkdownCardTool = createTool({
  id: "add_markdown_card",
  description:
    "Drop a markdown card on the canvas — the right tool for descriptions, explanations, reports, or articles. The card renders the markdown as rich text. Use markdown freely (headings, bullets, code, tables).",
  inputSchema: z.object({
    x: z.number().describe("Page-space X for the top-left corner."),
    y: z.number().describe("Page-space Y for the top-left corner."),
    w: z
      .number()
      .min(120)
      .max(1200)
      .default(360)
      .describe("Card width in page pixels. Default 360 is good for prose."),
    h: z
      .number()
      .min(80)
      .max(1200)
      .default(220)
      .describe("Card height. Default 220."),
    markdown: z
      .string()
      .min(1)
      .describe("The markdown content of the card."),
  }),
  outputSchema: z.object({
    shapeId: z.string(),
  }),
});

export const addMermaidCardTool = createTool({
  id: "add_mermaid_card",
  description:
    "Drop a Mermaid diagram card on the canvas. Use this for flowcharts, sequence diagrams, ER diagrams, state machines, class diagrams, mindmaps, or gantt charts. The card renders the Mermaid source to SVG.",
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().min(200).max(1600).default(560),
    h: z.number().min(120).max(1200).default(340),
    kind: z
      .enum([
        "flowchart",
        "sequence",
        "state",
        "erd",
        "class",
        "mindmap",
        "gantt",
      ])
      .describe("Kind of diagram — sets the renderer expectation."),
    mermaid: z
      .string()
      .min(1)
      .describe(
        "Valid Mermaid source. Start with the diagram keyword (e.g. `flowchart LR`, `sequenceDiagram`, `stateDiagram-v2`).",
      ),
  }),
  outputSchema: z.object({
    shapeId: z.string(),
  }),
});

export const canvasTools = {
  query_canvas: queryCanvasTool,
  add_shapes: addShapesTool,
  add_markdown_card: addMarkdownCardTool,
  add_mermaid_card: addMermaidCardTool,
};

export type CanvasShapeInput = z.infer<typeof shapeInputSchema>;
