import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { idempotencyKeyField, toolResultSchema } from "./_envelope";

/**
 * Canvas tools. None of them define an `execute` function — they're
 * client-side tools. The server (Mastra agent) advertises them to the
 * model with `description + inputSchema + outputSchema` only; the live
 * Excalidraw canvas in the browser actually executes them via
 * `useChat`'s `onToolCall`, which routes through `tool-dispatcher.ts`.
 *
 * Every tool's outputSchema is wrapped in the standard envelope from
 * `_envelope.ts`. The agent reads `result.ok` to decide whether to
 * unpack `result.data` or recover via `result.error.code`.
 *
 * The vocabulary describes what the canvas SHOULD do at a level
 * above the rendering engine: `geo` is "the rectangle / ellipse /
 * diamond family"; arrows bind by id; cards are markdown / mermaid.
 * Kept intentionally narrow so a future engine swap can re-map the
 * same intents without changing the agent prompt.
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

// Engine-neutral geo enum. Both canvases support these three
// natively; legacy values (cloud, star, hexagon, …) used to
// exist but are silently mapped to `rectangle` so older saved
// prompts still draw something sensible.
const geoSchema = z.enum(["rectangle", "ellipse", "diamond"]);

// Shape input — what the model emits per shape it wants to draw.
const shapeInputSchema = z.object({
  type: z
    .enum(["geo", "arrow", "text", "note", "frame"])
    .describe(
      "Shape family. `geo` is a rectangle / ellipse / diamond (set `geo` to pick the subtype). `arrow` connects two points or shape ids. `text` is a free-standing label. `note` is a sticky note (yellow rectangle). `frame` is a titled group that contains other shapes.",
    ),
  x: z
    .number()
    .optional()
    .describe("Page-space X. For `arrow`, ignored — use `start`/`end`."),
  y: z.number().optional(),
  geo: geoSchema
    .optional()
    .describe(
      "Subtype for `geo` shapes. One of `rectangle`, `ellipse`, `diamond`. Defaults to `rectangle`.",
    ),
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
    "Bulk-create one or more hand-drawn canvas shapes (rectangles / ellipses / diamonds, arrows, text, sticky notes, frames). Use this for diagrams composed of geometric primitives. Coordinates are in page space — call `query_canvas` first if you need to place things relative to existing content. For a single arrow between two existing shapes, prefer the higher-level `connect_shapes`.",
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

const arrowSideSchema = z
  .enum(["auto", "left", "right", "top", "bottom"])
  .describe(
    "Which edge of the bound shape the arrow attaches to. `auto` (default) lets the canvas pick the nearest edge — fine for most cases. Override when you want orthogonal routing or want to control entry/exit direction explicitly.",
  );

const arrowRoutingSchema = z
  .enum(["direct", "orthogonal"])
  .describe(
    "`direct` (default) draws a single straight segment from tail to head. `orthogonal` produces a right-angled elbow arrow that automatically routes around bound shapes — the canonical choice for boxes-and-arrows architecture diagrams.",
  );

export const connectShapesTool = createTool({
  id: "connect_shapes",
  description:
    "Draw a single arrow between two EXISTING shapes, with both ends bound (dragging either shape moves the arrow). Use this for \'connect auth → db\', \'arrow from queue to worker\'. Default routing is `direct` and edge anchoring is `auto`. Switch to `routing: \"orthogonal\"` for boxes-and-arrows architecture diagrams — the elbow arrow finds a clean right-angled path. Use `fromSide` / `toSide` when you need a specific entry/exit direction (e.g. \'connect right side of API to left side of DB\').",
  inputSchema: z.object({
    fromId: z.string().describe("Source shape id (arrow tail)."),
    toId: z.string().describe("Target shape id (arrow head)."),
    label: z
      .string()
      .optional()
      .describe("Optional text rendered on the arrow."),
    fromSide: arrowSideSchema.optional(),
    toSide: arrowSideSchema.optional(),
    routing: arrowRoutingSchema.optional(),
    color: colorSchema.optional(),
    size: sizeSchema.optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({ arrowId: z.string() }),
  ),
});

/* ─── connect_many ──────────────────────────────── */

export const connectManyTool = createTool({
  id: "connect_many",
  description:
    "Create several bound arrows in one atomic call. Use this for fan-outs (\'connect the gateway to all three workers\'), fan-ins (\'every service writes to the database\'), or building a diagram\'s wiring after \`add_shapes\` has placed the nodes. Far cheaper than firing \`connect_shapes\` N times — one undo step, one re-render, no token bloat. Each edge supports the same `fromSide` / `toSide` / `routing` options as `connect_shapes`.",
  inputSchema: z.object({
    edges: z
      .array(
        z.object({
          fromId: z.string(),
          toId: z.string(),
          label: z.string().optional(),
          fromSide: arrowSideSchema.optional(),
          toSide: arrowSideSchema.optional(),
          routing: arrowRoutingSchema.optional(),
          color: colorSchema.optional(),
          size: sizeSchema.optional(),
        }),
      )
      .min(1)
      .max(64)
      .describe(
        "Edges to create. Each becomes one bound arrow. The order is preserved in the returned `arrowIds` array.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      arrowIds: z
        .array(z.string())
        .describe(
          "One id per requested edge, in the same order as `edges`. Edges that failed to bind (missing shape ids) appear as empty strings — inspect `skipped` for details.",
        ),
      skipped: z
        .array(
          z.object({
            index: z.number().int(),
            reason: z.string(),
          }),
        )
        .describe("Edges that couldn\'t be created (e.g. unknown shape id)."),
    }),
  ),
});

/* ─── relabel_arrows ────────────────────────── */

export const relabelArrowsTool = createTool({
  id: "relabel_arrows",
  description:
    "Set, change, or clear the label on one or more existing arrows. Sugar over the bound-text mechanics — use this instead of `update_shapes` for arrow labels because creating a new bound text from scratch needs extra plumbing. Pass an empty string to remove a label.",
  inputSchema: z.object({
    labels: z
      .array(
        z.object({
          arrowId: z.string(),
          text: z
            .string()
            .describe("New label text. Empty string removes the existing label."),
        }),
      )
      .min(1)
      .max(64),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      updatedArrowIds: z.array(z.string()),
      missingArrowIds: z.array(z.string()),
    }),
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

/* ─── query_neighborhood ───────────────────────────────── *
 *
 * Spatial "what's around X" query — the agent's primary tool
 * for resolving phrases like "below the auth box", "next to
 * the queue", "shapes near the gateway". Without this the
 * agent has to do trigonometry in its head and gets it wrong.
 */

export const queryNeighborhoodTool = createTool({
  id: "query_neighborhood",
  description:
    "Return shapes located near a focal point (a shape id, a point, or the current selection), sorted by distance. Use this whenever the user references something spatially — 'below the auth box', 'next to the queue', 'the things on the right'. Cheaper and more useful than `query_canvas` for spatial questions. The focal point's own shape (if `near` is a shapeId) is excluded from results.",
  inputSchema: z.object({
    near: z
      .union([
        z.object({ shapeId: z.string() }),
        positionSchema,
        z.literal("selection"),
        z.literal("viewport"),
      ])
      .describe(
        "Focal anchor. `{ shapeId }` centres on a shape; `{ x, y }` on a page-space point; `'selection'` uses the current selection's centre; `'viewport'` uses the visible viewport's centre. If `'selection'` is empty, falls back to viewport.",
      ),
    radius: z
      .number()
      .positive()
      .max(20000)
      .optional()
      .describe(
        "Maximum distance in page pixels from the focal point's centre to a candidate shape's centre. Defaults to 600 — enough for ~1 screen at typical zoom.",
      ),
    direction: z
      .enum(["any", "above", "below", "left", "right"])
      .optional()
      .describe(
        "Constrain results to one side of the focal point. `above` = candidates whose centre y < focal y; similarly for the others. Defaults to `any`.",
      ),
    types: z
      .array(
        z.enum([
          "geo",
          "arrow",
          "text",
          "note",
          "frame",
          "markdown-card",
          "mermaid-card",
        ]),
      )
      .optional()
      .describe("Restrict matches to these shape types."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max matches to return (default 12, ordered by distance)."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      focal: z.object({
        x: z.number(),
        y: z.number(),
        sourceShapeId: z.string().nullable(),
      }),
      matches: z
        .array(
          shapeRowSchema.extend({
            distance: z
              .number()
              .describe("Page-pixel distance from focal centre to shape centre."),
            direction: z
              .enum(["above", "below", "left", "right"])
              .describe("Dominant side relative to the focal point."),
          }),
        )
        .describe("Matches sorted ascending by distance."),
      totalMatched: z.number(),
      truncated: z.boolean(),
    }),
  ),
});

/* ─── get_connections ───────────────────────────────────── *
 *
 * Graph-walk: "what's connected to X?" Excalidraw stores
 * arrow bindings as `startBinding.elementId` /
 * `endBinding.elementId`, and each shape's incoming/outgoing
 * arrows in `boundElements`. The agent needs to walk this
 * without dumping the whole canvas.
 */

export const getConnectionsTool = createTool({
  id: "get_connections",
  description:
    "List the arrows bound to a shape and the shapes on the other end. Use this for 'what reads from the database?', 'what does auth talk to?', 'show me everything connected to the gateway'. Cheaper than `query_canvas` and gives you exactly what you need to reason about a node's neighbourhood in the graph.",
  inputSchema: z.object({
    shapeId: z.string().describe("Shape whose connections you want to inspect."),
    direction: z
      .enum(["in", "out", "both"])
      .optional()
      .describe(
        "`out` = arrows where this shape is the source (tail); `in` = arrows where it's the target (head); `both` is the default.",
      ),
    includeUnboundEndpoints: z
      .boolean()
      .optional()
      .describe(
        "If true, return arrows whose other endpoint is a free-floating point (no bound shape). Defaults to false — those edges are usually noise.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      shape: shapeRowSchema,
      connections: z.array(
        z.object({
          arrowId: z.string(),
          arrowLabel: z.string().optional(),
          direction: z
            .enum(["out", "in"])
            .describe("`out` if the focal shape is the arrow's source."),
          other: shapeRowSchema
            .nullable()
            .describe(
              "The shape on the other end of the arrow, or null if that endpoint is unbound (a free point).",
            ),
        }),
      ),
    }),
  ),
});

/* ─── find_free_space ───────────────────────────────────── *
 *
 * Returns a clear region the agent can drop new content into,
 * near an anchor, without overlapping existing shapes.
 * Replaces the agent's habit of computing "anchor.x + 320"
 * and hoping nothing's there.
 */

export const findFreeSpaceTool = createTool({
  id: "find_free_space",
  description:
    "Find a clear region of the canvas to drop new content into, without overlapping anything. Returns a top-left point and the requested size. Use this for 'add a Redis cache near the API', 'put another service to the right of the gateway', 'drop a markdown card next to the diagram'. Far more reliable than computing offsets by hand.",
  inputSchema: z.object({
    size: z
      .object({
        w: z.number().positive().max(4000),
        h: z.number().positive().max(4000),
      })
      .describe("Desired width/height of the new content in page pixels."),
    near: z
      .union([
        z.object({ shapeId: z.string() }),
        positionSchema,
        z.literal("selection"),
        z.literal("viewport"),
      ])
      .optional()
      .describe(
        "Where to start searching from. Defaults to `'viewport'` (centre of what the user is currently looking at).",
      ),
    preferDirection: z
      .enum(["right", "below", "left", "above", "any"])
      .optional()
      .describe(
        "Bias the search outward in this direction first. `any` (the default) spirals outward in all four directions equally.",
      ),
    gap: z
      .number()
      .min(0)
      .max(400)
      .optional()
      .describe(
        "Minimum gap between the returned region and any existing shape (default 48 px).",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      x: z.number().describe("Page-space X of the top-left corner of the free region."),
      y: z.number().describe("Page-space Y of the top-left corner."),
      w: z.number(),
      h: z.number(),
      attempts: z
        .number()
        .describe(
          "How many candidate slots were tested before this one was accepted. Useful for debugging crowded boards.",
        ),
      relaxed: z
        .boolean()
        .describe(
          "True if the search exhausted its budget and returned a best-effort slot that may still overlap. Treat the result as a hint, not a guarantee.",
        ),
    }),
  ),
});

/* ─── query_frame ───────────────────────────────────────── */

export const queryFrameTool = createTool({
  id: "query_frame",
  description:
    "List the shapes inside a frame (titled group) plus the frame's bounds. Cheaper than `query_canvas` when you only care about one cluster, and reliably scoped to the frame's contents.",
  inputSchema: z.object({
    frameId: z
      .string()
      .describe("Id of the frame whose contents you want to inspect."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      frame: shapeRowSchema,
      children: z.array(shapeRowSchema),
      bounds: z.object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    }),
  ),
});

/* ─── set_selection ─────────────────────────────────────── *
 *
 * Programmatic selection. The chat-as-pointer move: after a
 * non-trivial edit, the agent highlights what it touched so
 * the user knows where to look and `Cmd+Z` cleanly undoes.
 */

export const setSelectionTool = createTool({
  id: "set_selection",
  description:
    "Replace the user's current selection with the given shape ids. Use this as the final step of a multi-shape edit (so undo lands on exactly what you just touched) or to draw the user's attention to something specific you're discussing in chat. Pass an empty array to deselect everything.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .describe(
        "Shape ids to select. Pass an empty array to clear the selection.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      selectedShapeIds: z.array(z.string()),
      missingShapeIds: z
        .array(z.string())
        .describe("Ids that were not on the canvas. Empty array on full success."),
    }),
  ),
});

/* ─── focus_camera ──────────────────────────────────────── *
 *
 * Pan + zoom the user's camera. Without this the agent can
 * build something the user never sees — "I added it but where?".
 */

export const focusCameraTool = createTool({
  id: "focus_camera",
  description:
    "Pan and gently zoom the user's camera so the given shapes (or bounds) are centred in view. Use this after a non-trivial edit so the user actually sees what was placed, or when the user says 'show me X' / 'where is the database'. Animated by default — keep this for moments that matter, not every micro-edit.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(1)
      .optional()
      .describe("Shapes to fit on screen. Mutually exclusive with `bounds`."),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .optional()
      .describe(
        "Explicit page-space rect to fit on screen. Use when you want the camera to land somewhere not tied to a specific shape.",
      ),
    padding: z
      .number()
      .min(0)
      .max(0.5)
      .optional()
      .describe(
        "Fraction of viewport reserved as breathing room around the target (0.1 = 10 %, default 0.15).",
      ),
    animate: z
      .boolean()
      .optional()
      .describe(
        "Animate the camera move (default true). Set false for instant snaps.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      framed: z
        .object({
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        })
        .describe("The page-space rect the camera was fitted to."),
    }),
  ),
});

/* ─── update_shapes ─────────────────────────────────────── */

const shapeUpdateSchema = z.object({
  id: z
    .string()
    .describe(
      "Canvas shape id, returned by `query_canvas`, `find_shapes`, or `add_shapes`. Opaque string — don't try to parse it.",
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
    "Modify properties of EXISTING canvas shapes. Use this for iterations like 'make the auth box red', 'rename that frame to Backend', 'move the database 200px right', 'make those arrows thicker'. Provide only the fields that change; everything else is preserved. Target shapes by their `id` (from `query_canvas`, `find_shapes`, or the output of `add_shapes`). Don't recreate shapes when an update is enough.",
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

/* ─── layout_shapes ─────────────────────────────────────── *
 *
 * Arrange existing shapes into a clean structure. The agent's
 * answer to "line these up", "make this a grid", "stack them",
 * "lay this out as a tree from the gateway". Operates on existing
 * shapes — does NOT create or delete anything. Arrows bound to
 * the laid-out shapes follow automatically.
 */

export const layoutShapesTool = createTool({
  id: "layout_shapes",
  description:
    "Rearrange existing shapes into a clean row, column, grid, or tree. Use this for 'line these up', 'make a 3-column grid', 'stack them vertically', or 'lay this out as a tree from the gateway'. Does not create or delete anything — arrows bound to the moved shapes follow automatically. Pair with `find_free_space` if you also need to place new content nearby.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(2)
      .describe(
        "Shapes to lay out. Order matters for `row` and `column`: first id ends up leftmost / topmost. For `grid` order fills row-by-row. For `tree` the order is ignored — `rootShapeId` drives traversal.",
      ),
    kind: z
      .enum(["row", "column", "grid", "tree"])
      .describe(
        "`row` = horizontal line, `column` = vertical line, `grid` = wrap into `columns` columns, `tree` = lay out as a graph starting from `rootShapeId` following outgoing arrows.",
      ),
    gap: z
      .object({
        x: z.number().min(0).max(2000).optional(),
        y: z.number().min(0).max(2000).optional(),
      })
      .optional()
      .describe(
        "Spacing between cells in page pixels. Defaults: row/grid x=48, column/grid y=48, tree x=80 y=120.",
      ),
    columns: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Only used by `kind: \"grid\"`. Defaults to ceil(sqrt(n))."),
    rootShapeId: z
      .string()
      .optional()
      .describe(
        "Only used by `kind: \"tree\"`. The id at the top/left of the tree. Must be one of `shapeIds`.",
      ),
    direction: z
      .enum(["down", "right", "up", "left"])
      .optional()
      .describe(
        "Only used by `kind: \"tree\"`. Which way children grow from the root. Defaults to `down`.",
      ),
    origin: z
      .union([
        positionSchema,
        z.object({ shapeId: z.string() }),
        z.literal("viewport"),
        z.literal("preserve"),
      ])
      .optional()
      .describe(
        "Where the laid-out group's top-left lands. `preserve` (default) keeps the existing bounding-box top-left so nothing jumps. `viewport` centres in view. `{shapeId}` aligns to that shape's top-left. `{x,y}` is explicit page-space.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      laidOutShapeIds: z.array(z.string()),
      missingShapeIds: z.array(z.string()),
      bounds: z.object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    }),
  ),
});

/* ─── duplicate_shapes ──────────────────────────────────── *
 *
 * Clone a set of shapes with fresh ids, optionally several times,
 * with an automatic offset so copies don't sit on top of the
 * originals. Arrows whose BOTH endpoints are in the selection are
 * cloned and rebound to the new copies — cross-boundary arrows
 * are dropped.
 *
 * Bound text labels of cloned containers are always carried along
 * (they're part of the container's visual identity).
 */

export const duplicateShapesTool = createTool({
  id: "duplicate_shapes",
  description:
    "Clone shapes with fresh ids, optionally several times. Arrows whose endpoints are both in the selection are cloned and rebound; arrows crossing the selection are dropped. Use this for 'add 3 more workers like this one', 'duplicate this row twice', 'I need another auth box'. The copies are offset (by default below the originals) so they don't overlap. Returns the new ids so you can immediately wire / focus / select them.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(1)
      .describe("Shape ids to duplicate."),
    count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("How many copies to make (default 1)."),
    direction: z
      .enum(["right", "below", "left", "above"])
      .optional()
      .describe(
        "Sugar for `offset`. The copies stack in this direction with a gap roughly the size of the selection bounding box. Mutually exclusive with `offset`. Default `below`.",
      ),
    offset: z
      .object({
        dx: z.number(),
        dy: z.number(),
      })
      .optional()
      .describe(
        "Per-copy delta in page pixels. Copy N is at offset × N from the original. Mutually exclusive with `direction`.",
      ),
    labelSuffix: z
      .string()
      .max(40)
      .optional()
      .describe(
        "Appended to every text label on every copy (e.g. \" copy\" or \" v2\"). Useful for keeping diagram clones distinguishable.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      newShapeIds: z
        .array(z.string())
        .describe(
          "All new shape ids, in creation order: copy-1 shapes, then copy-2, … Useful for piping straight into `set_selection` or `focus_camera`.",
        ),
      copies: z
        .array(
          z.object({
            copyIndex: z.number().int().min(1),
            idMap: z
              .record(z.string(), z.string())
              .describe(
                "Map from original shape id → new shape id for this copy. Includes auto-copied bound text labels and intra-selection arrows.",
              ),
          }),
        )
        .describe("One entry per copy."),
      missingShapeIds: z.array(z.string()),
      droppedArrows: z
        .array(z.string())
        .describe(
          "Arrows that were in `shapeIds` but had an endpoint outside the selection — not cloned.",
        ),
    }),
  ),
});

/* ─── delete_shapes ─────────────────────────────────────── */

export const deleteShapesTool = createTool({
  id: "delete_shapes",
  description:
    "Remove one or more shapes from the whiteboard by id. Use this when the user says 'remove the auth box', 'clear that arrow', or wants to undo a previous addition. Arrows bound to a deleted shape are detached automatically.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .min(1)
      .describe("Canvas shape ids to delete (from `query_canvas` etc.)."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      deletedShapeIds: z.array(z.string()),
      missingShapeIds: z.array(z.string()),
    }),
  ),
});

/* ─── analyze_canvas / explain_diagram ──────────────── */

const issueKindSchema = z.enum([
  "orphan",
  "dangling_arrow",
  "overlap",
  "unlabeled",
  "off_canvas",
  "style_drift",
]);

export const analyzeCanvasTool = createTool({
  id: "analyze_canvas",
  description:
    "Inspect the canvas for common quality issues: orphan shapes (no arrows in/out), dangling arrows (endpoint unbound or pointing at a missing shape), overlapping shapes, geo boxes with no label, off-canvas outliers, and style drift inside a frame. Use this whenever the user asks 'is the board clean?', 'what looks off?', 'spot any issues?', or as a self-check after a big rebuild before reporting back. Returns one row per issue with the offending shape ids and a human-readable description.",
  inputSchema: z.object({
    categories: z
      .array(issueKindSchema)
      .optional()
      .describe(
        "Restrict the analysis to specific issue kinds. Omit to run every check.",
      ),
    frameId: z
      .string()
      .optional()
      .describe(
        "If set, only consider shapes inside this frame (plus the frame itself). Useful for 'audit just this section'.",
      ),
    offCanvasThreshold: z
      .number()
      .positive()
      .optional()
      .describe(
        "Distance in page units from the nearest neighbour above which a shape is flagged as off-canvas. Defaults to 800.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      issues: z.array(
        z.object({
          kind: issueKindSchema,
          shapeIds: z.array(z.string()),
          description: z.string(),
          severity: z.enum(["info", "warning"]),
        }),
      ),
      summary: z.object({
        total: z.number().int(),
        byCategory: z.record(z.string(), z.number().int()),
      }),
    }),
  ),
});

export const explainDiagramTool = createTool({
  id: "explain_diagram",
  description:
    "Summarise the canvas's structure into prose. Walks frames, identifies connected components, surfaces 'anchor' shapes (high degree), and produces a brief narration plus per-section bodies. Use this when the user asks 'what does this board show?', 'recap the diagram', 'walk me through this' — it's much richer than dumping `query_canvas`. Optionally scope to a single frame.",
  inputSchema: z.object({
    frameId: z
      .string()
      .optional()
      .describe("Restrict the explanation to one frame's contents."),
    verbose: z
      .boolean()
      .optional()
      .describe(
        "When true, include per-shape labels and edge inventories. Defaults to false (headline + per-frame bodies only).",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      headline: z.string().describe(
        "One-sentence summary of the whole diagram (or scoped frame).",
      ),
      sections: z.array(
        z.object({
          title: z.string(),
          body: z.string(),
        }),
      ),
      stats: z.object({
        shapeCount: z.number().int(),
        arrowCount: z.number().int(),
        frameCount: z.number().int(),
        componentCount: z.number().int(),
      }),
    }),
  ),
});

/* ─── insert_template / add_image ────────────────── */

const placementAnchorSchema = z
  .union([
    z.object({ shapeId: z.string() }),
    positionSchema,
    z.literal("selection"),
    z.literal("viewport"),
    z.literal("free_space"),
  ])
  .describe(
    "Where to place the result. `{ shapeId }` aligns the top-left to that shape's centre. `{ x, y }` is an explicit page-space point. `'selection'` and `'viewport'` use those centres. `'free_space'` runs find_free_space-style placement near the viewport centre so the new content doesn't overlap existing shapes.",
  );

const templateKindSchema = z.enum([
  "auth_flow",
  "request_lifecycle",
  "microservices",
  "erd",
  "sequence_skeleton",
  "mvp_roadmap",
  "retro_quadrant",
  "decision_tree",
]);

export const insertTemplateTool = createTool({
  id: "insert_template",
  description:
    "Drop a pre-designed shape cluster onto the canvas. Use this for common diagram skeletons — `auth_flow`, `request_lifecycle`, `microservices`, `erd`, `sequence_skeleton`, `mvp_roadmap`, `retro_quadrant`, `decision_tree`. The agent should reach for this whenever the user wants the *standard* version of a diagram and only later customise; it's far cheaper than hand-building a 10-node skeleton with `add_shapes` + `connect_many`. All templates are anchored: by default they land in clean space near the viewport centre, but you can pin them to a shape, a point, or the current selection.",
  inputSchema: z.object({
    kind: templateKindSchema.describe(
      "Which template to insert. Each produces a labelled, connected cluster that's already laid out cleanly — the agent doesn't need to align or wire anything.",
    ),
    anchor: placementAnchorSchema.optional(),
    title: z
      .string()
      .optional()
      .describe(
        "Optional frame title wrapping the whole template. When set, the cluster is grouped into a frame so the user can move it as one unit.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      kind: templateKindSchema,
      shapeIds: z
        .array(z.string())
        .describe(
          "All shapes the template created, in z-order. The first id is typically the most useful 'anchor' (e.g. for `auth_flow` it's the Client box). Pass these back into other tools to customise.",
        ),
      frameId: z
        .string()
        .optional()
        .describe("Frame id, when `title` was provided."),
      origin: z
        .object({ x: z.number(), y: z.number() })
        .describe("Top-left page-space coordinate where the template was placed."),
    }),
  ),
});

export const addImageTool = createTool({
  id: "add_image",
  description:
    "Drop an image onto the canvas as a native Excalidraw image element (selectable, draggable, resizable, exportable). Pass either `svg` (raw SVG markup the agent generates — perfect for vector icons, logos, sparklines) or `dataUrl` (a `data:image/...;base64,...` string). The image is stored in the scene's BinaryFiles map; nothing leaves the browser.",
  inputSchema: z.object({
    svg: z
      .string()
      .optional()
      .describe(
        "Raw SVG markup. Agent-friendly for icons, logos, simple charts — anything you can express in SVG. Mutually exclusive with `dataUrl`.",
      ),
    dataUrl: z
      .string()
      .optional()
      .describe(
        "Pre-encoded `data:image/...;base64,...` URL. Mutually exclusive with `svg`.",
      ),
    width: z
      .number()
      .positive()
      .optional()
      .describe("Image width in page units. Defaults to 240."),
    height: z
      .number()
      .positive()
      .optional()
      .describe("Image height in page units. Defaults to 240."),
    anchor: placementAnchorSchema.optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      imageId: z.string(),
      fileId: z.string(),
      origin: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
});

/* ─── screenshot_canvas ──────────────────────────────── */

export const screenshotCanvasTool = createTool({
  id: "screenshot_canvas",
  description:
    "Capture a PNG of the current Excalidraw scene (or a subset of shapes) and hand it back as a data URL. Use AFTER `analyze_canvas` for any non-trivial build — the screenshot catches visual problems the structured audit can't measure (label clipping, arrow tangle, off-canvas drift). The executor auto-shrinks the export to fit a 2 MB budget; if even the smallest scale is too big you'll get `size_limit` and should narrow `shapeIds` / `frameId` to a smaller region.",
  inputSchema: z.object({
    shapeIds: z
      .array(z.string())
      .optional()
      .describe(
        "Restrict the screenshot to these shape ids (plus their bound text / arrows). Omit to capture the whole scene.",
      ),
    frameId: z
      .string()
      .optional()
      .describe(
        "Restrict to a single frame and its contents. Mutually exclusive with `shapeIds` — `frameId` wins if both are passed.",
      ),
    padding: z
      .number()
      .nonnegative()
      .max(200)
      .optional()
      .describe(
        "White-space margin around the captured region in pixels. Defaults to 24.",
      ),
    scale: z
      .number()
      .positive()
      .max(2)
      .optional()
      .describe(
        "Pixel ratio. `1` = native; `2` = retina. The executor walks the scale down if the resulting PNG exceeds the size budget, so this is just the starting point.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      dataUrl: z
        .string()
        .describe("`data:image/png;base64,...` you can read directly."),
      width: z.number(),
      height: z.number(),
      scale: z.number(),
      sizeBytes: z.number(),
      shapeCount: z
        .number()
        .describe("Number of shapes included in the capture."),
    }),
  ),
});

export const canvasTools = {
  query_canvas: queryCanvasTool,
  find_shapes: findShapesTool,
  query_neighborhood: queryNeighborhoodTool,
  get_connections: getConnectionsTool,
  find_free_space: findFreeSpaceTool,
  query_frame: queryFrameTool,
  add_shapes: addShapesTool,
  connect_shapes: connectShapesTool,
  connect_many: connectManyTool,
  relabel_arrows: relabelArrowsTool,
  align_shapes: alignShapesTool,
  distribute_shapes: distributeShapesTool,
  group_into_frame: groupIntoFrameTool,
  layout_shapes: layoutShapesTool,
  duplicate_shapes: duplicateShapesTool,
  update_shapes: updateShapesTool,
  delete_shapes: deleteShapesTool,
  analyze_canvas: analyzeCanvasTool,
  explain_diagram: explainDiagramTool,
  insert_template: insertTemplateTool,
  add_image: addImageTool,
  add_markdown_card: addMarkdownCardTool,
  add_mermaid_card: addMermaidCardTool,
  set_selection: setSelectionTool,
  focus_camera: focusCameraTool,
  screenshot_canvas: screenshotCanvasTool,
};

export type CanvasShapeInput = z.infer<typeof shapeInputSchema>;
