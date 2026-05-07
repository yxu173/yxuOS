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

export const patchNodeTool = createTool({
  id: "patch_node",
  description:
    "Surgically patch ONE DesignNode inside an artboard. This is much cheaper and more reliable than re-sending the whole tree via `update_artboard` — use it for 'make the hero darker', 'change the CTA copy to Get started', 'swap the accent to emerald', and any other tweak that touches a single node. Target the node by `nodeId` (returned by `get_artboard`, `find_nodes`, or in `query_canvas` as `selectedNodeId`). The `patch.style` is shallow-merged into the node's existing style so other style props are preserved; non-style fields (text, label, src, alt, href, placeholder, title) replace.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z
      .string()
      .describe(
        "The DesignNode `id`. Get one from `get_artboard`, `find_nodes`, or from `query_canvas`'s `selectedNodeId`.",
      ),
    patch: z
      .object({
        style: cssSchema,
        text: z
          .string()
          .optional()
          .describe("New text content for `text` nodes."),
        label: z
          .string()
          .optional()
          .describe("New label for `button` / `link` nodes."),
        src: z
          .string()
          .optional()
          .describe("New `src` URL for `image` nodes."),
        alt: z
          .string()
          .optional()
          .describe("New alt text for `image` nodes."),
        href: z
          .string()
          .optional()
          .describe("New href for `link` nodes."),
        placeholder: z
          .string()
          .optional()
          .describe("New placeholder for `input` nodes."),
        title: z
          .string()
          .optional()
          .describe("New title for `frame` nodes."),
      })
      .describe(
        "Partial update. `style` is shallow-merged with the existing style; the other fields replace.",
      ),
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

export const designCanvasTools = {
  query_canvas: queryCanvasTool,
  add_artboard: addArtboardTool,
  update_artboard: updateArtboardTool,
  delete_artboard: deleteArtboardTool,
  get_artboard: getArtboardTool,
  find_nodes: findNodesTool,
  patch_node: patchNodeTool,
  duplicate_node: duplicateNodeTool,
  apply_theme: applyThemeTool,
  extract_component: extractComponentTool,
  list_components: listComponentsTool,
  list_assets: listAssetsTool,
};
