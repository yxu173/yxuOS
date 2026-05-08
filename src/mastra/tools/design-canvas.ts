import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { idempotencyKeyField, toolResultSchema } from "./_envelope";

/**
 * Tools the design agent calls to read and mutate the design canvas.
 *
 * None of these define `execute` — they're client-side tools. The browser
 * runs them against the zustand store via `onToolCall` in the chat
 * component. The schemas here are what the model is shown.
 *
 * Every tool's outputSchema is wrapped in the standard envelope from
 * `_envelope.ts`. The agent reads `result.ok` and either uses
 * `result.data` or recovers from `result.error.code`.
 */

/* ─── DesignNode schema ─────────────────────────────────── */

const cssSchema = z
  .record(
    z.string(),
    z.union([z.string(), z.number()]),
  )
  .optional()
  .describe(
    "Inline CSS styles as a JSON object (camelCased keys: backgroundColor, fontSize, padding, etc.). Numbers are interpreted as pixels by React.",
  );

const baseNode = {
  id: z.string().optional(),
  style: cssSchema,
};

const designNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("component-ref"),
      ...baseNode,
      componentSlug: z
        .string()
        .describe(
          "Slug of a component in the user's library (returned by list_components). Renderer expands it inline.",
        ),
    }),
    z.object({
      type: z.literal("div"),
      ...baseNode,
      children: z.array(designNodeSchema).optional(),
    }),
    z.object({
      type: z.literal("section"),
      ...baseNode,
      children: z.array(designNodeSchema).optional(),
    }),
    z.object({
      type: z.literal("nav"),
      ...baseNode,
      children: z.array(designNodeSchema).optional(),
    }),
    z.object({
      type: z.literal("card"),
      ...baseNode,
      children: z.array(designNodeSchema).optional(),
    }),
    z.object({
      type: z.literal("frame"),
      ...baseNode,
      title: z.string().optional(),
      children: z.array(designNodeSchema).optional(),
    }),
    z.object({
      type: z.literal("text"),
      ...baseNode,
      text: z.string(),
      tag: z
        .enum(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label"])
        .optional(),
    }),
    z.object({
      type: z.literal("button"),
      ...baseNode,
      label: z.string(),
      variant: z.enum(["primary", "secondary", "ghost", "outline"]).optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
    }),
    z.object({
      type: z.literal("image"),
      ...baseNode,
      src: z.string().optional(),
      alt: z.string().optional(),
      placeholderColor: z.string().optional(),
      placeholderIcon: z.string().optional(),
    }),
    z.object({
      type: z.literal("input"),
      ...baseNode,
      placeholder: z.string().optional(),
      inputType: z
        .enum(["text", "email", "password", "search", "number", "tel"])
        .optional(),
      label: z.string().optional(),
    }),
    z.object({
      type: z.literal("icon"),
      ...baseNode,
      name: z.string().describe("Lucide icon name in kebab-case, e.g. 'arrow-right'."),
      size: z.number().optional(),
      color: z.string().optional(),
    }),
    z.object({
      type: z.literal("link"),
      ...baseNode,
      label: z.string(),
      href: z.string().optional(),
    }),
    z.object({
      type: z.literal("divider"),
      ...baseNode,
      orientation: z.enum(["horizontal", "vertical"]).optional(),
    }),
  ]),
);

/* ─── Common ────────────────────────────────────────────── */

const devicePresetSchema = z
  .enum(["desktop", "laptop", "tablet", "mobile", "custom"])
  .describe(
    "Device preset. desktop=1440×900, laptop=1280×800, tablet=768×1024, mobile=393×852. `custom` requires explicit w + h.",
  );

const artboardRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  device: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  hasDesign: z.boolean(),
  rootNodeType: z.string().optional(),
});

const nodeMatchSchema = z.object({
  id: z.string(),
  type: z.string(),
  depth: z.number(),
  /** Short summary, e.g. `text/h1: "Welcome"` or `button: "Get started"`. */
  summary: z.string(),
});

/* ─── Tools ─────────────────────────────────────────────── */

export const queryCanvasTool = createTool({
  id: "query_canvas",
  description:
    "List existing artboards on the design canvas with their position, dimensions, name, device preset, and a one-line summary of any design tree they contain. Call this BEFORE add_artboard if you need to position relative to existing screens (e.g. 'put the mobile version next to the desktop one'). Also returns `selectedNodeId` — the DesignNode the user has selected inside an artboard, if any. When a node is selected and the user says 'make this red' / 'change this copy', target that exact id with `patch_node`.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      artboards: z.array(artboardRowSchema),
      selectedArtboardIds: z.array(z.string()),
      selectedNodeId: z
        .string()
        .nullable()
        .describe(
          "ID of the DesignNode the user clicked on inside an artboard, if any. Use this to target the user's current focus with `patch_node` when they say things like 'make this red' or 'change this copy'.",
        ),
    }),
  ),
});

export const addArtboardTool = createTool({
  id: "add_artboard",
  description:
    "Create a new artboard on the canvas with a complete DesignNode tree inside. Use a tall height (1800-3200) for full landing pages so the whole page fits. Position is in world coordinates — omit `x`/`y` to auto-place to the right of the rightmost existing artboard. The tree is validated structurally before being committed; on `error.code === 'validation_failed'` you'll see exactly which constraint failed (max depth, max node count, oversized text, etc.).",
  inputSchema: z.object({
    name: z
      .string()
      .describe(
        "Human-readable name shown above the artboard, e.g. 'Stride landing — Desktop'.",
      ),
    device: devicePresetSchema,
    width: z
      .number()
      .optional()
      .describe(
        "Override the device preset's width. Required when device=custom. For tall landing pages, set width to the device width and use a custom height.",
      ),
    height: z
      .number()
      .optional()
      .describe(
        "Override the device preset's height. Use a tall value (1800-3200) for full landing pages so the whole design fits without clipping.",
      ),
    x: z.number().optional(),
    y: z.number().optional(),
    design: designNodeSchema
      .optional()
      .describe(
        "Root DesignNode tree to render inside. Can be omitted for an empty artboard.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(z.object({ artboardId: z.string() })),
});

export const updateArtboardTool = createTool({
  id: "update_artboard",
  description:
    "Patch an existing artboard. Use this for STRUCTURAL changes — add/remove sections, reorder, swap layout. For surgical edits to a single element, prefer `patch_node`; it's much cheaper. Provide only the fields you want to change. To replace the entire design tree, pass the new tree as `design` — it will be validated before commit.",
  inputSchema: z.object({
    artboardId: z.string(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    design: designNodeSchema.optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(z.object({ artboardId: z.string() })),
});

export const deleteArtboardTool = createTool({
  id: "delete_artboard",
  description: "Remove an artboard from the canvas.",
  inputSchema: z.object({
    artboardId: z.string(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(z.object({ artboardId: z.string() })),
});

export const getArtboardTool = createTool({
  id: "get_artboard",
  description:
    "Read the full DesignNode tree of an artboard. Every node in the returned tree has a stable `id` you can target with `patch_node`. Call this once when the user asks for a small tweak so you know which `id` to patch — afterwards, prefer `patch_node` over `update_artboard` for surgical edits. For finding nodes by type/text instead of dumping the whole tree, use `find_nodes`.",
  inputSchema: z.object({ artboardId: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      id: z.string(),
      name: z.string(),
      device: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      design: z.unknown().nullable(),
    }),
  ),
});

/* ─── find_nodes ────────────────────────────────────────── */

export const findNodesTool = createTool({
  id: "find_nodes",
  description:
    "Search inside an artboard's tree by type/tag/text/style — returns matching nodeIds + a one-line summary of each. Much cheaper than `get_artboard` when you just need to find 'all primary buttons', 'the h1 heading', 'every input', 'anything labelled Pricing', etc. Use this before `patch_node` when the user describes the target instead of clicking it.",
  inputSchema: z.object({
    artboardId: z.string(),
    type: z
      .enum([
        "div",
        "section",
        "nav",
        "card",
        "frame",
        "text",
        "button",
        "image",
        "input",
        "icon",
        "link",
        "divider",
        "component-ref",
      ])
      .optional()
      .describe("Restrict to nodes of this type."),
    tag: z
      .enum(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label"])
      .optional()
      .describe("For `text` nodes — only match this semantic tag."),
    variant: z
      .enum(["primary", "secondary", "ghost", "outline"])
      .optional()
      .describe("For `button` nodes — only match this variant."),
    textIncludes: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring matched against `text` (text), `label` (button/link), `placeholder` (input), `alt` (image), or `title` (frame).",
      ),
    hasStyleKey: z
      .string()
      .optional()
      .describe(
        "Match nodes whose `style` object contains this key (camelCase, e.g. `backgroundColor`, `fontSize`). Useful for finding 'every node with a custom background'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max matches to return (default 50)."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      matches: z.array(nodeMatchSchema),
      totalMatched: z.number(),
      truncated: z.boolean(),
    }),
  ),
});

/* ─── duplicate_node ───────────────────────────────────── */

export const duplicateNodeTool = createTool({
  id: "duplicate_node",
  description:
    "Deep-clone a node and append the copy as the next sibling. Fresh ids are generated for every cloned node. Use this for 'add another feature card just like this one', 'duplicate this section'. The root of an artboard cannot be duplicated this way — use `add_artboard` for a sibling page.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z.string().describe("Id of the node to duplicate."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      newNodeId: z.string(),
    }),
  ),
});

/* ─── apply_theme ──────────────────────────────────────── */

export const applyThemeTool = createTool({
  id: "apply_theme",
  description:
    "Re-theme an entire artboard in one call. Patches every primary button to use the accent color, every link/icon-as-accent to use it too, applies the radius to buttons/cards/inputs, and sets the root container's font family. Use for 'rebrand to emerald', 'make the radius softer', 'switch to Inter'. Returns the count of nodes that were touched.",
  inputSchema: z.object({
    artboardId: z.string(),
    theme: z
      .object({
        accent: z
          .string()
          .optional()
          .describe(
            "Accent color (any CSS color: `#10b981`, `emerald`, `rgb(16,185,129)`). Applied to primary buttons' background, link colors, and accent icon nodes.",
          ),
        accentForeground: z
          .string()
          .optional()
          .describe(
            "Text color for primary buttons against `accent`. Defaults to white.",
          ),
        radius: z
          .number()
          .min(0)
          .max(48)
          .optional()
          .describe("Border-radius (px) for buttons, cards, inputs."),
        fontFamily: z
          .string()
          .optional()
          .describe(
            "CSS font-family stack applied to the root node (e.g. `Inter, system-ui, sans-serif`).",
          ),
      })
      .describe("Provide only the fields you want to apply."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      patchedNodeIds: z.array(z.string()),
      patchCount: z.number(),
    }),
  ),
});

/* ─── extract_component ────────────────────────────────── */

export const extractComponentTool = createTool({
  id: "extract_component",
  description:
    "Promote a subtree of an artboard into a saved, reusable component. The subtree is cloned (with fresh ids) and stored in the user's library under the given name; the original location in the artboard is replaced with a `component-ref`, so editing the saved component once propagates everywhere. Use this when the user says 'save this as a component', 'reuse this nav', 'I want to use this everywhere'.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z.string().describe("Id of the node to promote."),
    name: z
      .string()
      .min(1)
      .describe("Human-readable name of the new component."),
    slug: z
      .string()
      .optional()
      .describe(
        "Optional slug. Defaults to a slugified version of `name`. Slug collisions are auto-resolved server-side.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      componentId: z.string(),
      componentSlug: z.string(),
    }),
  ),
});

/* ─── patch_node ───────────────────────────────────────── */

/**
 * Shared patch shape between `patch_node` and `patch_nodes`. Each
 * field applies only to the matching node type — patches against
 * non-matching types are silently skipped so a single patch can
 * target a mixed-type id list cleanly.
 */
const nodePatchSchema = z
  .object({
    style: cssSchema,
    text: z.string().optional().describe("`text` nodes — new text content."),
    label: z
      .string()
      .optional()
      .describe("`button`/`link` nodes — new label text."),
    src: z.string().optional().describe("`image` nodes — new src URL."),
    alt: z.string().optional().describe("`image` nodes — new alt text."),
    href: z.string().optional().describe("`link` nodes — new href."),
    placeholder: z
      .string()
      .optional()
      .describe("`input` nodes — new placeholder text."),
    title: z
      .string()
      .optional()
      .describe("`frame` nodes — new title above the frame."),
    placeholderColor: z
      .string()
      .optional()
      .describe(
        "`image` nodes — placeholder fill color when no `src` is set (CSS color: `#10b981`, `zinc`, `rgb(...)`).",
      ),
    placeholderIcon: z
      .string()
      .optional()
      .describe("`image` nodes — lucide icon name shown in the placeholder."),
    iconName: z
      .string()
      .optional()
      .describe("`icon` nodes — lucide name in kebab-case (e.g. `arrow-right`)."),
    iconSize: z
      .number()
      .optional()
      .describe("`icon` nodes — pixel size."),
    iconColor: z
      .string()
      .optional()
      .describe("`icon` nodes — stroke / fill color."),
    buttonVariant: z
      .enum(["primary", "secondary", "ghost", "outline"])
      .optional()
      .describe("`button` nodes — visual variant."),
    buttonSize: z
      .enum(["sm", "md", "lg"])
      .optional()
      .describe("`button` nodes — height (sm=32px, md=40px, lg=48px)."),
    tag: z
      .enum(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label"])
      .optional()
      .describe("`text` nodes — semantic tag, also adjusts default size."),
    inputType: z
      .enum(["text", "email", "password", "search", "number", "tel"])
      .optional()
      .describe("`input` nodes — html input type."),
    orientation: z
      .enum(["horizontal", "vertical"])
      .optional()
      .describe("`divider` nodes — orientation."),
  })
  .describe(
    "Partial update. `style` is shallow-merged. All other fields replace, but each only applies to its matching node type — patches against non-matching types are silently skipped.",
  );

export const patchNodeTool = createTool({
  id: "patch_node",
  description:
    "Surgically patch ONE DesignNode inside an artboard. Much cheaper and more reliable than re-sending the whole tree via `update_artboard` — use it for 'make the hero darker', 'change the CTA copy', 'swap to outline button', 'use a different lucide icon', and any other tweak that touches a single node. Target the node by `nodeId` (from `get_artboard`, `find_nodes`, or `query_canvas`'s `selectedNodeId`). `patch.style` shallow-merges; the typed leaf fields (label/buttonVariant/iconName/etc.) replace and only apply when the node's type matches.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z
      .string()
      .describe(
        "The DesignNode `id`. Get one from `get_artboard`, `find_nodes`, or from `query_canvas`'s `selectedNodeId`.",
      ),
    patch: nodePatchSchema,
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      nodeId: z.string(),
    }),
  ),
});

/* ─── list_components / list_assets ────────────────────── */

export const listComponentsTool = createTool({
  id: "list_components",
  description:
    "List the user's saved design-system components. Use this BEFORE composing a new design so you know what reusable pieces (logos, brand buttons, signature sections) already exist. Reference any of them in your design tree as { type: 'component-ref', componentSlug: '<slug>' } — the renderer expands them inline. Editing a component once propagates to every design that uses it.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      components: z.array(
        z.object({
          slug: z.string(),
          name: z.string(),
          rootType: z.string(),
          nodeCount: z.number(),
        }),
      ),
    }),
  ),
});

export const listAssetsTool = createTool({
  id: "list_assets",
  description:
    "List the user's uploaded image assets — logos, brand imagery, photos. Use this BEFORE composing a design so you can reference real imagery via { type: 'image', src: '<url>', alt: '...' } instead of dropping a placeholder rectangle. Output includes the file name and a public URL ready to use as the `src` of an image node.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      assets: z.array(
        z.object({
          name: z.string(),
          url: z.string(),
          mimeType: z.string(),
        }),
      ),
    }),
  ),
});

/* ─── Granular node CRUD ────────────────────────────────── */

const insertPositionSchema = z
  .enum(["append", "prepend", "before", "after"])
  .describe(
    "Where to put the new nodes relative to `targetNodeId`. `append`/`prepend` treat target as the parent container; `before`/`after` treat target as a sibling.",
  );

export const addNodesTool = createTool({
  id: "add_nodes",
  description:
    "Insert one or more DesignNodes into an existing artboard at a specific spot. MUCH cheaper than re-emitting the whole tree via `update_artboard` — use this for 'add another testimonial card after this one', 'add a footer at the end of the page', 'prepend a banner to the hero section'. The target's role depends on `position`: with `append` or `prepend`, target is the parent container the new nodes get added to; with `before` or `after`, target is a sibling and the new nodes become its previous / next siblings inside the same parent. The inserted subtrees are validated structurally (depth / node count / text length / forbidden styles) and every node ends up with a stable `id` you can target later.",
  inputSchema: z.object({
    artboardId: z.string(),
    targetNodeId: z
      .string()
      .describe(
        "Either the parent container's id (when `position` is append/prepend) or a sibling's id (when before/after).",
      ),
    position: insertPositionSchema,
    nodes: z
      .array(designNodeSchema)
      .min(1)
      .describe(
        "One or more DesignNodes to insert. Order is preserved. Provide ids if you want to refer to specific inserted nodes later, otherwise fresh ids are assigned.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      insertedNodeIds: z.array(z.string()),
    }),
  ),
});

export const deleteNodesTool = createTool({
  id: "delete_nodes",
  description:
    "Remove one or more nodes (and their entire subtrees) from an artboard in a single call. Use this for 'remove the testimonials section', 'drop the secondary CTA', 'clear out the duplicate cards'. Refuses to delete the artboard root — use `delete_artboard` for that. Returns the ids that were actually deleted (missing ids are silently skipped so partial states are safe).",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeIds: z
      .array(z.string())
      .min(1)
      .describe("Ids of the nodes to delete."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      deletedNodeIds: z.array(z.string()),
    }),
  ),
});

export const moveNodesTool = createTool({
  id: "move_nodes",
  description:
    "Reparent or reorder one or more nodes within the same artboard. Atomic: if any part of the move is invalid (target inside the moved subtree, missing nodes, anchoring on a moved node), nothing is applied. Use this for 'move the email signup above the features', 'put the FAQ below the pricing', 'group these cards into the sidebar'. Same `targetNodeId` + `position` semantics as `add_nodes`.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeIds: z
      .array(z.string())
      .min(1)
      .describe("Ids of the nodes to move. Order is preserved."),
    targetNodeId: z.string(),
    position: insertPositionSchema,
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      movedNodeIds: z.array(z.string()),
    }),
  ),
});

export const patchNodesTool = createTool({
  id: "patch_nodes",
  description:
    "Apply the SAME patch to many nodes in one call. Cheap way to do 'make every h2 zinc-300', 'set every primary button to indigo', 'increase all card padding to 32'. Same patch semantics as `patch_node` — every typed leaf field is applied only to nodes of the matching type, so passing a mixed list (e.g. all selected ids) works cleanly. Returns the ids that were actually patched. Missing ids surface in `warnings`.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeIds: z
      .array(z.string())
      .min(1)
      .describe("Ids of the nodes to patch."),
    patch: nodePatchSchema,
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      patchedNodeIds: z.array(z.string()),
    }),
  ),
});

/* ─── duplicate_artboard ───────────────────────────────── */

export const duplicateArtboardTool = createTool({
  id: "duplicate_artboard",
  description:
    "Clone an entire artboard (its full DesignNode tree, with fresh ids) and place the copy next to the original. Use for 'make a mobile version of this' (then `update_artboard` the clone's width/height + apply mobile-specific tweaks via `patch_node`s), 'duplicate this onboarding step so I can iterate on a variant', or any 'copy this whole screen and let me fork it'. By default the new artboard is positioned to the right of the source with an 80-px gap; pass explicit `x`/`y` to override.",
  inputSchema: z.object({
    artboardId: z.string(),
    name: z
      .string()
      .optional()
      .describe(
        "Name for the new artboard. Defaults to '<original name> (copy)'.",
      ),
    x: z.number().optional(),
    y: z.number().optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      sourceArtboardId: z.string(),
    }),
  ),
});

/* ─── screenshot_artboard ──────────────────────────────── */

export const screenshotArtboardTool = createTool({
  id: "screenshot_artboard",
  description:
    "Capture a rendered PNG screenshot of an artboard and feed it back as an image input on the next turn — so you can SEE what you actually drew. Use this after `add_artboard` for any tall (>1200px) or visually critical screen, after a `apply_theme` reskin, or whenever the user reports something looks broken (overflow, contrast, alignment) and you can't tell from the JSON. Then look at the image, decide what's wrong, and `patch_node` / `patch_nodes` / `move_nodes` to fix it. The screenshot is auto-downscaled if it would exceed ~2 MB; if even the smallest scale is too large, you get `size_limit` and should screenshot a sub-region by patching the artboard temporarily smaller.",
  inputSchema: z.object({
    artboardId: z
      .string()
      .describe("Id of the artboard to capture (from `query_canvas`)."),
    scale: z
      .number()
      .min(0.25)
      .max(2)
      .optional()
      .describe(
        "Render scale (1 = artboard's pixel size). Default 1; the executor auto-downscales if the encoded PNG exceeds ~2 MB.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      width: z.number(),
      height: z.number(),
      /** Base64 data URL — converted to image/png file-data when fed
       *  back to the model. Don't quote this back at the user; just
       *  read it. */
      dataUrl: z.string(),
      /** Effective scale used after any auto-downscaling. */
      scale: z.number(),
      sizeBytes: z.number(),
    }),
  ),
  // Convert the screenshot data URL into a real image input on the
  // next inference step. Without this, Claude would just see a base64
  // blob inside JSON and not be able to "look" at the design.
  //
  // Mastra threads `toModelOutput` straight through to the AI SDK
  // language-model layer; the return shape is LanguageModelV3ToolResultOutput.
  toModelOutput: (output: unknown) => {
    if (!output || typeof output !== "object") {
      return { type: "json", value: null };
    }
    const result = output as {
      ok?: boolean;
      data?: {
        artboardId: string;
        width: number;
        height: number;
        dataUrl: string;
        scale: number;
      };
      error?: { code: string; message: string; hint?: string };
    };
    if (!result.ok || !result.data) {
      // Errors stay as JSON so the agent can switch on `error.code`.
      return { type: "json", value: result };
    }
    const { artboardId, width, height, dataUrl, scale } = result.data;
    // Strip the "data:image/png;base64," prefix; file-data wants raw
    // base64 bytes.
    const base64 = dataUrl.includes(",") ? dataUrl.split(",", 2)[1]! : dataUrl;
    return {
      type: "content",
      value: [
        {
          type: "text",
          text: `Screenshot of artboard "${artboardId}" — ${width}×${height} px @ ${scale}× scale. Look at it; the JSON tree might be valid but the rendered pixels can still be off.`,
        },
        {
          type: "file-data",
          mediaType: "image/png",
          data: base64,
          filename: `${artboardId}.png`,
        },
      ],
    };
  },
});

/* ─── save_attachment_as_asset ─────────────────────────── */

export const saveAttachmentAsAssetTool = createTool({
  id: "save_attachment_as_asset",
  description:
    "Persist an image the user attached in this chat (paperclip / paste / drag-and-drop) into the team's asset library so you can reference it from `image` nodes via its public URL. After this tool succeeds, you can use the returned `url` immediately in `add_artboard` / `add_nodes` / `patch_node` — and `list_assets` will include it on subsequent turns. Use this whenever the user attaches a logo, brand image, or photo and you intend to put it in the design. Pass the EXACT `filename` of the FileUIPart you want to save (e.g. \"stride-logo.svg\"); the client looks the bytes up by filename in the recent message history.",
  inputSchema: z.object({
    filename: z
      .string()
      .min(1)
      .describe(
        "Filename of the user-attached image, exactly as shown on the FileUIPart in the message history (e.g. 'logo.png').",
      ),
    name: z
      .string()
      .optional()
      .describe(
        "Optional display name for the saved asset. Defaults to the filename — only override if the user gave it a different label.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      id: z.string(),
      url: z.string(),
      name: z.string(),
      mimeType: z.string(),
      size: z.number(),
    }),
  ),
});

/* ─── update_component ─────────────────────────────────── */

export const updateComponentTool = createTool({
  id: "update_component",
  description:
    "Edit a saved component's tree in place. Every artboard that uses `{ type: 'component-ref', componentSlug }` for this slug renders the new tree on the next paint, so this is how you propagate a brand change once and have it land everywhere. Look up the slug via `list_components`. The new tree is validated structurally before commit.",
  inputSchema: z.object({
    componentSlug: z
      .string()
      .describe("Slug of the component to edit (from `list_components`)."),
    name: z
      .string()
      .optional()
      .describe("Optional new name. Slug doesn't change."),
    tree: designNodeSchema.describe(
      "Full replacement DesignNode tree for the component.",
    ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      componentSlug: z.string(),
    }),
  ),
});

export const designCanvasTools = {
  query_canvas: queryCanvasTool,
  add_artboard: addArtboardTool,
  update_artboard: updateArtboardTool,
  delete_artboard: deleteArtboardTool,
  duplicate_artboard: duplicateArtboardTool,
  get_artboard: getArtboardTool,
  find_nodes: findNodesTool,
  patch_node: patchNodeTool,
  patch_nodes: patchNodesTool,
  add_nodes: addNodesTool,
  delete_nodes: deleteNodesTool,
  move_nodes: moveNodesTool,
  duplicate_node: duplicateNodeTool,
  screenshot_artboard: screenshotArtboardTool,
  apply_theme: applyThemeTool,
  extract_component: extractComponentTool,
  update_component: updateComponentTool,
  list_components: listComponentsTool,
  list_assets: listAssetsTool,
  save_attachment_as_asset: saveAttachmentAsAssetTool,
};
