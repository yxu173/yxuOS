import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { idempotencyKeyField, toolResultSchema } from "./_envelope";

/**
 * Canvas tools. None of them define an `execute` function — they're
 * client-side tools. The server (Mastra agent) advertises them to the
 * model with `description + inputSchema + outputSchema` only; the live
 * tldraw editor in the browser actually executes them via `useChat`'s
 * `onToolCall`.
 *
 * Every tool's outputSchema is wrapped in the standard envelope from
 * `_envelope.ts`. The agent reads `result.ok` to decide whether to
 * unpack `result.data` or recover via `result.error.code`.
 */

const positionSchema = z.object({
  x: z.number().describe("X coordinate in page space (not screen pixels)."),
  y: z.number().describe("Y coordinate in page space."),
});

const colorSchema = z.enum([
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
]);

const sizeSchema = z.enum(["s", "m", "l", "xl"]);
const fillSchema = z.enum(["none", "semi", "solid", "pattern"]);

const geoSchema = z.enum([
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
]);

// Shape input — what the model emits per shape it wants to draw.
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
  geo: geoSchema
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
  color: colorSchema
    .optional()
    .describe("Stroke / fill colour for geo / arrow / note."),
  fill: fillSchema
    .optional()
    .describe("Fill style for geo shapes. Defaults to none (just outline)."),
  size: sizeSchema
    .optional()
    .describe("Size preset for the stroke / text."),
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

/* ─── shared output sub-schemas ─────────────────────────── */

const shapeRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
  text: z.string().optional(),
});

const cameraSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/* ─── query_canvas (now paginated + summary mode) ───────── */

export const queryCanvasTool = createTool({
  id: "query_canvas",
  description:
    "Read what is currently on the whiteboard. Always call this BEFORE adding new shapes if you need to position them relative to existing content. The response always carries a cheap `summary` (counts + sample labels) so you can decide whether to ask for the full list. Use `summaryOnly: true` on big boards to skip the per-shape payload entirely. Use `viewportOnly: true` when the user means 'what's on screen right now'. The `shapes` array is paginated — use `limit` + `cursor` if you need more than 100 shapes.",
  inputSchema: z.object({
    summaryOnly: z
      .boolean()
      .optional()
      .describe(
        "If true, skip the per-shape `shapes` array — return only `summary`, camera, viewport, and selection. Use this when you only need to know what KIND of content is on the canvas, not every shape's details. Saves tokens.",
      ),
    viewportOnly: z
      .boolean()
      .optional()
      .describe(
        "If true, only return shapes whose bounds intersect the user's current viewport. Use this when the user says 'what's on screen' / 'this area' / similar. The `summary` still reflects the full canvas counts.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Max shapes to return in `shapes` (default 100)."),
    cursor: z
      .string()
      .optional()
      .describe(
        "Opaque pagination cursor returned as `nextCursor` from a prior call. Pass it back to fetch the next page.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      summary: z.object({
        totalShapes: z.number(),
        byType: z.record(z.string(), z.number()),
        sampleLabels: z
          .array(z.string())
          .describe(
            "Up to 10 short labels from across the canvas — enough to recognise what's there without dumping every shape.",
          ),
      }),
      shapes: z
        .array(shapeRowSchema)
        .optional()
        .describe(
          "Per-shape rows. Omitted in `summaryOnly` mode. May be truncated — see `truncated` and `nextCursor`.",
        ),
      returned: z.number(),
      truncated: z.boolean(),
      nextCursor: z.string().nullable(),
      camera: cameraSchema,
      viewport: viewportSchema,
      selectedShapeIds: z.array(z.string()),
    }),
  ),
});

/* ─── find_shapes ───────────────────────────────────────── */

export const findShapesTool = createTool({
  id: "find_shapes",
  description:
    "Look up shapes by label substring or by type, without dumping the whole canvas. Use this when the user references something by name ('the auth box', 'the queue', 'the notes') and you need the id to update / delete / connect it. Much cheaper than `query_canvas` on big boards. Returns up to `limit` matches (default 20).",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring matched against each shape's text/label. Omit to match every shape (combined with `type` / `viewportOnly`).",
      ),
    type: z
      .enum(["geo", "arrow", "text", "note", "frame", "markdown-card", "mermaid-card"])
      .optional()
      .describe("Restrict matches to shapes of this type."),
    viewportOnly: z
      .boolean()
      .optional()
      .describe("Only match shapes whose bounds intersect the current viewport."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max matches to return (default 20)."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      matches: z.array(shapeRowSchema),
      totalMatched: z.number(),
      truncated: z.boolean(),
    }),
  ),
});

/* ─── add_shapes ────────────────────────────────────────── */

export const addShapesTool = createTool({
  id: "add_shapes",
  description:
    "Bulk-create one or more native tldraw shapes (hand-drawn rectangles, ellipses, arrows, text, sticky notes, frames). Use this for diagrams composed of geometric primitives. Coordinates are in page space — call `query_canvas` first if you need to place things relative to existing content. For a single arrow between two existing shapes, prefer the higher-level `connect_shapes`.",
  inputSchema: z.object({
    shapes: z
      .array(shapeInputSchema)
      .min(1)
      .describe("Array of shape descriptions to create in one batch."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({ createdShapeIds: z.array(z.string()) }),
  ),
});

/* ─── connect_shapes ────────────────────────────────────── */

export const connectShapesTool = createTool({
  id: "connect_shapes",
  description:
    "Draw a single arrow between two EXISTING shapes, with both ends bound to the shapes (so dragging either endpoint shape moves the arrow). Much more reliable than computing arrow start/end coordinates by hand. Use this for 'connect auth → db', 'arrow from the queue to the worker', etc. The arrow auto-anchors to each shape's center.",
  inputSchema: z.object({
    fromId: z.string().describe("Source shape id (arrow tail)."),
    toId: z.string().describe("Target shape id (arrow head)."),
    label: z
      .string()
      .optional()
      .describe("Optional text rendered on the arrow."),
    color: colorSchema.optional(),
    size: sizeSchema.optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({ arrowId: z.string() }),
  ),
});

/* ─── align_shapes / distribute_shapes ──────────────────── */

export const alignShapesTool = createTool({
  id: "align_shapes",
  description:
    "Align two or more existing shapes along an axis. Saves you from computing coordinates by hand — the canvas does the math. Use for 'line these up', 'top-align the boxes', 'center them horizontally'.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(2)
      .describe("At least 2 shape ids to align."),
    operation: z
      .enum([
        "left",
        "right",
        "top",
        "bottom",
        "center-horizontal",
        "center-vertical",
      ])
      .describe(
        "`left`/`right`/`top`/`bottom` snap edges to the leftmost/topmost/etc. shape. `center-horizontal` aligns vertical centers (a horizontal row); `center-vertical` aligns horizontal centers (a vertical column).",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({ alignedShapeIds: z.array(z.string()) }),
  ),
});

export const distributeShapesTool = createTool({
  id: "distribute_shapes",
  description:
    "Evenly space three or more existing shapes along the horizontal or vertical axis. Use for 'spread these out evenly', 'distribute them horizontally'.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(3)
      .describe("At least 3 shape ids to distribute."),
    axis: z.enum(["horizontal", "vertical"]),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({ distributedShapeIds: z.array(z.string()) }),
  ),
});

/* ─── group_into_frame ──────────────────────────────────── */

export const groupIntoFrameTool = createTool({
  id: "group_into_frame",
  description:
    "Wrap one or more existing shapes in a new frame (titled group). The frame is sized to fit the shapes with padding, and the shapes are reparented inside. Use for 'group these as Backend', 'put the auth boxes in a frame called Auth'.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(1)
      .describe("Shapes to enclose in the new frame."),
    title: z.string().describe("Frame title shown above the group."),
    padding: z
      .number()
      .int()
      .min(0)
      .max(400)
      .optional()
      .describe("Padding around the contained shapes in page pixels (default 32)."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      frameId: z.string(),
      framedShapeIds: z.array(z.string()),
    }),
  ),
});

/* ─── add_markdown_card / add_mermaid_card ──────────────── */

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
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(z.object({ shapeId: z.string() })),
});

export const addMermaidCardTool = createTool({
  id: "add_mermaid_card",
  description:
    "Drop a Mermaid diagram card on the canvas. Use this for flowcharts, sequence diagrams, ER diagrams, state machines, class diagrams, mindmaps, or gantt charts. The card renders the Mermaid source to SVG. The source is parsed before the card is created — on a syntax error you'll get `error.code === 'validation_failed'` and NO card is created. Read the message, fix the source, retry once.",
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
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(z.object({ shapeId: z.string() })),
});

/* ─── update_shapes ─────────────────────────────────────── */

const shapeUpdateSchema = z.object({
  id: z
    .string()
    .describe(
      "tldraw shape id, returned by `query_canvas` or `add_shapes` (looks like `shape:abc...`).",
    ),
  x: z.number().optional().describe("Move to this page-space X."),
  y: z.number().optional().describe("Move to this page-space Y."),
  w: z.number().optional().describe("New width (geo / frame / note)."),
  h: z.number().optional().describe("New height (geo / frame / note)."),
  text: z
    .string()
    .optional()
    .describe(
      "Replace the shape's label / text / sticky-note body / frame title. Markdown / mermaid cards take their content via the dedicated add_* tools, not here.",
    ),
  color: colorSchema.optional(),
  fill: fillSchema.optional(),
  size: sizeSchema.optional(),
});

export const updateShapesTool = createTool({
  id: "update_shapes",
  description:
    "Modify properties of EXISTING tldraw shapes. Use this for iterations like 'make the auth box red', 'rename that frame to Backend', 'move the database 200px right', 'make those arrows thicker'. Provide only the fields that change; everything else is preserved. Target shapes by their `id` (from `query_canvas`, `find_shapes`, or the output of `add_shapes`). Don't recreate shapes when an update is enough.",
  inputSchema: z.object({
    shapes: z
      .array(shapeUpdateSchema)
      .min(1)
      .describe("Array of shape updates to apply in one batch."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      updatedShapeIds: z.array(z.string()),
      missingShapeIds: z
        .array(z.string())
        .describe(
          "Ids that were not on the canvas. Empty array on full success.",
        ),
    }),
  ),
});

/* ─── delete_shapes ─────────────────────────────────────── */

export const deleteShapesTool = createTool({
  id: "delete_shapes",
  description:
    "Remove one or more shapes from the whiteboard by id. Use this when the user says 'remove the auth box', 'clear that arrow', or wants to undo a previous addition. Bound arrows pointing at a deleted shape are detached automatically by tldraw.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(1)
      .describe("tldraw shape ids to delete (from `query_canvas` etc.)."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      deletedShapeIds: z.array(z.string()),
      missingShapeIds: z.array(z.string()),
    }),
  ),
});

export const canvasTools = {
  query_canvas: queryCanvasTool,
  find_shapes: findShapesTool,
  add_shapes: addShapesTool,
  connect_shapes: connectShapesTool,
  align_shapes: alignShapesTool,
  distribute_shapes: distributeShapesTool,
  group_into_frame: groupIntoFrameTool,
  update_shapes: updateShapesTool,
  delete_shapes: deleteShapesTool,
  add_markdown_card: addMarkdownCardTool,
  add_mermaid_card: addMermaidCardTool,
};

export type CanvasShapeInput = z.infer<typeof shapeInputSchema>;
