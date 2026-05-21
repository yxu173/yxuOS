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

const flowToSchema = z
  .object({
    artboardId: z
      .string()
      .describe("Target artboard's id (from `query_canvas`)."),
  })
  .optional()
  .describe(
    "Prototype link — clicking this button/link conceptually navigates to the target artboard. Drawn as an arrow in flow-view; ignored otherwise. Co-located on the node so it travels with `duplicate_node`, `move_nodes`, and `extract_component`.",
  );

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
      flowTo: flowToSchema,
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
      flowTo: flowToSchema,
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
    "Re-theme the entire design by writing well-known design tokens (`color.accent`, `color.accentForeground`, `radius.md`, `font.family`). The renderer reads tokens live, so every node whose style references one of these tokens (e.g. `style.backgroundColor: \"{color.accent}\"`) re-skins on the next paint — no per-node walk needed. NOTE: only nodes that USE token references are affected; inline literal values (`backgroundColor: \"#10b981\"`) are unchanged. For old artboards built before tokens existed, follow up with a few `patch_nodes` calls or have the agent re-emit critical sections referencing the new tokens. Use for 'rebrand to emerald', 'make the radius softer', 'switch to Inter'.",
  inputSchema: z.object({
    artboardId: z
      .string()
      .describe(
        "Kept for backwards compatibility — tokens are design-scoped (not per-artboard) so this just confirms which design's tokens to write.",
      ),
    theme: z
      .object({
        accent: z
          .string()
          .optional()
          .describe(
            "Accent color (any CSS color). Writes to `color.accent` token.",
          ),
        accentForeground: z
          .string()
          .optional()
          .describe(
            "Text color for primary buttons against `accent`. Writes to `color.accentForeground`.",
          ),
        radius: z
          .number()
          .min(0)
          .max(48)
          .optional()
          .describe("Border-radius (px). Writes to `radius.md` token."),
        fontFamily: z
          .string()
          .optional()
          .describe(
            "CSS font-family stack. Writes to `font.family` token.",
          ),
      })
      .describe("Provide only the fields you want to apply."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      tokensWritten: z.array(z.string()),
    }),
  ),
});

/* ─── list_tokens / set_tokens ─────────────────────────── */

const tokenValueSchema = z
  .union([z.string(), z.number()])
  .describe(
    "Token value: a CSS color string, font-family string, pixel number, etc. The renderer feeds this directly into React `style` so any value React accepts on the matching style key works.",
  );

const tokenPatchValueSchema = z
  .union([z.string(), z.number(), z.null()])
  .describe(
    "Patch value: a fresh value to set, or `null` to remove the token (lets a wider scope or literal win again).",
  );

export const listTokensTool = createTool({
  id: "list_tokens",
  description:
    "Read the active design's token set. Returns the team-default tokens, the per-design overrides, and a `merged` view (design wins per-key) plus a list of common token paths the prompt encourages. Use this BEFORE composing a new design (so you can reference existing tokens like `\"{color.accent}\"` instead of hard-coding hex), and BEFORE `set_tokens` so you don't clobber existing values you didn't mean to.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      team: z.record(z.string(), tokenValueSchema),
      design: z.record(z.string(), tokenValueSchema),
      merged: z.record(z.string(), tokenValueSchema),
      commonPaths: z.array(z.string()),
    }),
  ),
});

export const setTokensTool = createTool({
  id: "set_tokens",
  description:
    "Write design tokens. Two scopes: `\"design\"` patches per-design tokens (the design row's `tokens` jsonb); `\"team\"` patches the team's brand baseline (the `team_design_tokens` row). The patch is a flat `{ \"dotted.path\": value | null }` map — set new values or use `null` to clear a key. Returns the merged token map after the write. Token paths are free-form (any dotted string), but prefer the common namespaces — `color.*`, `font.*`, `radius.*`, `spacing.*`. Use this when the user asks for a brand change, a rebrand, or wants a token reusable across designs (`scope: \"team\"`). For one-off color tweaks on a single node, prefer `patch_node`.",
  inputSchema: z.object({
    scope: z
      .enum(["design", "team"])
      .describe(
        "`\"design\"` for per-design overrides; `\"team\"` for the team-default baseline (every design picks them up).",
      ),
    patch: z
      .record(z.string(), tokenPatchValueSchema)
      .describe(
        "Flat patch keyed on dotted token path. e.g. { \"color.accent\": \"#10b981\", \"radius.md\": 12, \"old.token\": null }.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      scope: z.enum(["design", "team"]),
      tokens: z.record(z.string(), tokenValueSchema),
      writtenKeys: z.array(z.string()),
      clearedKeys: z.array(z.string()),
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

/* ─── flows ────────────────────────────────────────────── */

export const connectArtboardsTool = createTool({
  id: "connect_artboards",
  description:
    "Wire a button or link to a target artboard so it shows as a prototype-flow arrow when the user toggles flow-view. Sets `flowTo: { artboardId }` on the source node. Use for 'when this button is clicked, go to the dashboard', 'wire the onboarding flow', 'connect login → home'. The arrow is purely visual — clicking the button on the canvas doesn't actually navigate. The flow edge travels with `duplicate_node`, `move_nodes`, and `extract_component`, so wiring once is enough.",
  inputSchema: z.object({
    artboardId: z
      .string()
      .describe("Source artboard's id (where the button/link lives)."),
    nodeId: z
      .string()
      .describe(
        "Source node's id — must be a `button` or `link` node. Anything else returns `preconditions_failed`.",
      ),
    toArtboardId: z
      .string()
      .describe("Target artboard's id — where clicking would navigate."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      nodeId: z.string(),
      toArtboardId: z.string(),
    }),
  ),
});

export const disconnectArtboardsTool = createTool({
  id: "disconnect_artboards",
  description:
    "Remove a flow link from a button/link. Inverse of `connect_artboards`. Use for 'unhook this button from the dashboard', 'clear all the prototype flows from this screen' (call it once per node), etc.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z.string(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      nodeId: z.string(),
    }),
  ),
});

export const listFlowsTool = createTool({
  id: "list_flows",
  description:
    "Read every prototype-flow edge across all artboards. Returns `{ sourceArtboardId, sourceNodeId, sourceLabel, sourceType, toArtboardId }[]` so you can answer 'what's wired up?', verify a flow exists before connecting again, or describe the prototype to the user. Cheap — pure tree walk, no DOM.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      flows: z.array(
        z.object({
          sourceArtboardId: z.string(),
          sourceNodeId: z.string(),
          sourceLabel: z.string(),
          sourceType: z.enum(["button", "link"]),
          toArtboardId: z.string(),
        }),
      ),
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

/* ─── wrap_nodes ───────────────────────────────────────── */

export const wrapNodesTool = createTool({
  id: "wrap_nodes",
  description:
    "Wrap N adjacent siblings of the same parent in a fresh container (div/section/card/frame/nav). The new container takes the position of the first wrapped sibling and inherits the optional `style` you pass. Use for `group these three cards into a section`, `wrap the email + password inputs in a card`, `nest these features under one div with flex column`. The wrapped nodes must be contiguous siblings of one parent — if they aren't, call `move_nodes` first to put them next to each other.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeIds: z
      .array(z.string())
      .min(1)
      .describe(
        "Ids of the nodes to wrap. Must be contiguous siblings of one parent.",
      ),
    containerType: z
      .enum(["div", "section", "card", "frame", "nav"])
      .describe("Type of container to create."),
    style: cssSchema.describe(
      "Optional inline style for the new container (e.g. `{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }`).",
    ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      containerId: z.string(),
      wrappedNodeIds: z.array(z.string()),
    }),
  ),
});

/* ─── unwrap_node ────────────────────────────────────── */

export const unwrapNodeTool = createTool({
  id: "unwrap_node",
  description:
    "Remove a container and promote its children into its parent at the same position. Use for `flatten this section`, `the card is redundant — drop the wrapper`, `un-group these`. Inverse of `wrap_nodes`. Refuses on the artboard root or on a leaf node.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z
      .string()
      .describe("Id of the container to dissolve."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      promotedNodeIds: z.array(z.string()),
    }),
  ),
});

/* ─── replace_node ───────────────────────────────────── */

export const replaceNodeTool = createTool({
  id: "replace_node",
  description:
    "Atomically swap a node (and its entire subtree) with a brand-new DesignNode. Use when the new shape can't be expressed by `patch_node` (which only mutates fields of the same type) — e.g. `turn this button into an image`, `swap this empty placeholder with a real testimonials card`, `replace this divider with a proper section`. Refuses to replace the artboard root — use `update_artboard` for that. The replacement is validated structurally and run through id assignment so every node ends up with a stable id.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z
      .string()
      .describe("Id of the node to replace (and its entire subtree)."),
    replacement: designNodeSchema.describe(
      "Full DesignNode tree to drop in. Will be validated before commit.",
    ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      newNodeId: z.string(),
    }),
  ),
});

/* ─── set_node_visibility ──────────────────────────────── */

export const setNodeVisibilityTool = createTool({
  id: "set_node_visibility",
  description:
    "Hide or show a node without deleting it. Hidden nodes stay in the tree (ids stable, layers panel still shows them dimmed) but the renderer skips them. Use for `hide this section to compare without it`, `try the page without the FAQ`, `restore the testimonials`. Cheaper than delete+re-add when iterating on layout.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeId: z.string(),
    hidden: z
      .boolean()
      .describe("true = hide; false = show."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      nodeId: z.string(),
      hidden: z.boolean(),
    }),
  ),
});

/* ─── align_nodes ──────────────────────────────────────── */

export const alignNodesTool = createTool({
  id: "align_nodes",
  description:
    "Align and/or distribute nodes inside a flex container. `align` writes `alignSelf` on each target (cross-axis alignment); `distribute` writes `justifyContent` on the parent (main-axis spacing). Use for `center these three buttons`, `right-align the metric numbers`, `distribute these icons evenly`. Combine both in one call for `center and evenly space`. If neither field is provided, returns `invalid_input`.",
  inputSchema: z.object({
    artboardId: z.string(),
    nodeIds: z
      .array(z.string())
      .describe(
        "Ids to apply `align` to. Ignored when only `distribute` is set.",
      ),
    align: z
      .enum(["start", "center", "end", "stretch"])
      .optional()
      .describe(
        "Cross-axis alignment via `alignSelf`. start=flex-start, end=flex-end.",
      ),
    distributeParentId: z
      .string()
      .optional()
      .describe(
        "Container whose children get `justifyContent`. Defaults to the artboard root.",
      ),
    distribute: z
      .enum(["space-between", "space-around", "space-evenly"])
      .optional()
      .describe("Main-axis spacing for the parent's children."),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      alignedNodeIds: z.array(z.string()),
      distributedParentId: z.string().nullable(),
    }),
  ),
});

/* ─── audit_design ─────────────────────────────────────── */

export const auditDesignTool = createTool({
  id: "audit_design",
  description:
    "Critique your own work against design rules: placeholder copy (Lorem ipsum / \"Button 1\" / etc.), missing alt text on images, contrast ratio below WCAG AA (4.5:1) on text, oversized button labels (>30 chars), tiny text (<12px), cramped cards (<12px padding), unlabelled inputs, duplicate h1s, empty containers. Returns a flat list of `{ code, severity, nodeId, message, hint }` per artboard. ALWAYS call this right after composing a complex artboard — then sort by `severity: error` first and bulk-fix with `patch_nodes`. The agent's main self-correction loop. Cheaper than `screenshot_artboard` for catching design rule violations the JSON tree CAN see; pair with screenshot for visual issues (overflow, alignment) that the audit can't.",
  inputSchema: z.object({
    artboardId: z
      .string()
      .optional()
      .describe(
        "Audit one artboard. Omit to audit every artboard on the canvas.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboards: z.array(
        z.object({
          artboardId: z.string(),
          artboardName: z.string(),
          issues: z.array(
            z.object({
              code: z.string(),
              severity: z.enum(["error", "warning", "info"]),
              nodeId: z.string().nullable(),
              message: z.string(),
              hint: z.string().optional(),
            }),
          ),
        }),
      ),
      totalIssues: z.number(),
      summary: z.object({
        error: z.number(),
        warning: z.number(),
        info: z.number(),
      }),
    }),
  ),
});

/* ─── arrange_artboards ────────────────────────────────── */

export const arrangeArtboardsTool = createTool({
  id: "arrange_artboards",
  description:
    "Tidy the canvas by snapping artboards into a clean grid, row, or column. Use for `lay these out left-to-right as a flow`, `stack these vertically`, `tidy this mess into a grid`. Defaults: 80-px gap, origin = top-left of the existing cluster (so the camera doesn't yank to (0,0)). Locked artboards are left alone. Pair with `connect_artboards` for a multi-step flow that reads cleanly.",
  inputSchema: z.object({
    strategy: z
      .enum(["grid", "row", "column"])
      .describe(
        "row=horizontal line left→right; column=vertical line top→bottom; grid=square-ish row-major grid.",
      ),
    artboardIds: z
      .array(z.string())
      .optional()
      .describe("Restrict to these artboards. Defaults to all."),
    gap: z
      .number()
      .min(0)
      .max(400)
      .optional()
      .describe("Gap in px between artboards. Default 80."),
    originX: z.number().optional(),
    originY: z.number().optional(),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      movedArtboardIds: z.array(z.string()),
    }),
  ),
});

/* ─── set_artboard_background ─────────────────────────── */

export const setArtboardBackgroundTool = createTool({
  id: "set_artboard_background",
  description:
    "Set the artboard's page background (the surface behind every node). Use for `dark mode this page` (`#0a0a0a`), `give this a soft tint`, `move to a brand background`. Any CSS color, gradient, or `var(--…)` string is accepted. To re-skin every accent on the page in one stroke, prefer `apply_theme` / `set_tokens` instead — background is just the page color.",
  inputSchema: z.object({
    artboardId: z.string(),
    background: z
      .string()
      .describe(
        "CSS color or gradient. e.g. `#0a0a0a`, `linear-gradient(180deg, #fff, #fafafa)`.",
      ),
    idempotencyKey: idempotencyKeyField,
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      background: z.string(),
    }),
  ),
});

/* ─── diff_artboards ──────────────────────────────────── */

const diffEntrySchema = z.object({
  kind: z
    .enum(["added", "removed", "modified"])
    .describe(
      "`added` = node exists only in B. `removed` = only in A. `modified` = same id in both, but type / style / payload changed.",
    ),
  path: z
    .string()
    .describe(
      "Dot path from the artboard root, e.g. `root.children[2].children[0]`, so the agent can `find_nodes` / `patch_node` against the right id.",
    ),
  nodeIdA: z.string().nullable(),
  nodeIdB: z.string().nullable(),
  summary: z
    .string()
    .describe(
      "One-line description suitable for the chat reply: `Hero title changed from \"X\" to \"Y\"`, `Pricing card added`, `Footer removed`.",
    ),
});

export const diffArtboardsTool = createTool({
  id: "diff_artboards",
  description:
    "Compare two artboards' design trees and return a structured list of added / removed / modified nodes plus a top-level summary. Use when the user asks 'what changed between these two?' or before / after a big iteration to verify the change matches intent. Cheap and pure (no LLM call); reach for it freely.",
  inputSchema: z.object({
    artboardIdA: z.string().describe("The 'before' artboard."),
    artboardIdB: z.string().describe("The 'after' artboard."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      summary: z.string(),
      additions: z.number().int(),
      removals: z.number().int(),
      modifications: z.number().int(),
      entries: z.array(diffEntrySchema),
    }),
  ),
});

/* ─── export_jsx ──────────────────────────────────────── */

export const exportJsxTool = createTool({
  id: "export_jsx",
  description:
    "Convert an artboard's design tree into ready-to-paste JSX (React) or HTML. Use when the user asks to 'hand this off to dev', 'export this', 'turn this into code'. Returns a single string the user can drop into a `.tsx` / `.html` file. Token refs (`{color.accent}`) are resolved to literals at export time so the snippet is self-contained.",
  inputSchema: z.object({
    artboardId: z.string(),
    target: z
      .enum(["react", "html"])
      .optional()
      .describe(
        "Output flavour. `react` emits JSX with camelCase style props + className-free divs (suitable for shadcn / Tailwind work). `html` emits plain HTML + inline `style=\"…\"`. Defaults to `react`.",
      ),
    indent: z
      .enum(["2", "4", "tab"])
      .optional()
      .describe("Indentation. Defaults to `2`."),
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      target: z.enum(["react", "html"]),
      code: z.string().describe("The exported snippet. Always a non-empty string when ok."),
      nodeCount: z.number().int(),
      lineCount: z.number().int(),
    }),
  ),
});

/* ─── find_and_replace ────────────────────────────────── */

export const findAndReplaceTool = createTool({
  id: "find_and_replace",
  description:
    "Search and replace text strings or style values across one artboard or the entire design. Use for 'change every Get started to Try it free', 'rebrand all #6366f1 to #10b981', 'swap Inter for Geist everywhere'. Scope controls whether text fields (labels, copy, placeholders, alt text), style values (CSS property values), or both are searched. Returns a per-artboard breakdown so you know exactly what changed.",
  inputSchema: z.object({
    find: z
      .string()
      .min(1)
      .describe("String to search for. Case-sensitive."),
    replace: z.string().describe("Replacement string."),
    scope: z
      .enum(["text", "style", "both"])
      .optional()
      .describe(
        "`text` = node text/label/placeholder/alt/title fields; `style` = CSS style property values; `both` = either. Defaults to `both`.",
      ),
    artboardId: z
      .string()
      .optional()
      .describe(
        "Restrict to one artboard. Omit to search every artboard on the canvas.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      totalMatched: z.number().int(),
      totalReplaced: z.number().int(),
      perArtboard: z.array(
        z.object({
          artboardId: z.string(),
          artboardName: z.string(),
          matched: z.number().int(),
          replaced: z.number().int(),
        }),
      ),
    }),
  ),
});

/* ─── analyze_consistency ──────────────────────────────── */

const consistencyIssueSchema = z.object({
  category: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  occurrences: z.number().int(),
  values: z.array(
    z.object({
      value: z.string(),
      count: z.number().int(),
    }),
  ),
});

export const analyzeConsistencyTool = createTool({
  id: "analyze_consistency",
  description:
    "Audit the entire design for visual inconsistencies — multiple border radii, varying button heights, mixed accent colors, inconsistent font sizes, mismatched padding, etc. Returns ranked issues with occurrence counts and the specific values found. Use before declaring a design 'polished' or when the user asks 'is this consistent?' / 'tighten this up'. Pure analysis, no mutation — follow up with `set_tokens` or `patch_nodes` to fix what it finds.",
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      issues: z.array(consistencyIssueSchema),
      totalIssues: z.number().int(),
    }),
  ),
});

/* ─── suggest_components ─────────────────────────────── */

export const suggestComponentsTool = createTool({
  id: "suggest_components",
  description:
    "Walk every artboard and flag repeated structural subtrees that should be extracted as reusable components. Returns a ranked list of candidates with occurrence count, estimated node savings, and an example path. Use when the user says 'component-ize this', 'make this reusable', or before handing off to dev. Pure analysis, no mutation — follow up with `extract_component` to promote the best candidates.",
  inputSchema: z.object({
    minOccurrences: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe(
        "Minimum times a pattern must appear to be suggested. Default 2.",
      ),
    minNodeCount: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe(
        "Minimum nodes in a subtree to be worth extracting. Default 3.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      suggestions: z.array(
        z.object({
          name: z.string(),
          occurrences: z.number().int(),
          nodeCount: z.number().int(),
          estimatedSavings: z.number().int(),
          examplePath: z.string(),
        }),
      ),
    }),
  ),
});

/* ─── set_grid ───────────────────────────────────────── */

export const setGridTool = createTool({
  id: "set_grid",
  description:
    "Apply a layout grid (columns, gutters, margins) to an artboard for alignment confidence. Use when the user says 'add a 12-column grid', 'give me 8-px gutters', 'layout grid please'. The grid is stored on the artboard and can be rendered as a faint overlay. Common presets: 12 cols / 24-px gutter / 48-px margin for desktop; 6 cols / 16-px gutter / 16-px margin for mobile.",
  inputSchema: z.object({
    artboardId: z.string(),
    columns: z
      .number()
      .int()
      .min(1)
      .max(24)
      .describe("Number of columns (e.g. 12 for standard web, 6 for mobile)."),
    gutter: z
      .number()
      .min(0)
      .max(200)
      .describe("Gutter width in pixels between columns."),
    margin: z
      .number()
      .min(0)
      .max(400)
      .describe("Outer margin in pixels from artboard edges."),
    color: z
      .string()
      .optional()
      .describe(
        "Grid line color (CSS color). Defaults to a faint zinc tone.",
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      artboardId: z.string(),
      grid: z.object({
        columns: z.number(),
        gutter: z.number(),
        margin: z.number(),
        color: z.string(),
      }),
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
  // World-class designer power-ups: structural refactor + self-critique.
  wrap_nodes: wrapNodesTool,
  unwrap_node: unwrapNodeTool,
  replace_node: replaceNodeTool,
  set_node_visibility: setNodeVisibilityTool,
  align_nodes: alignNodesTool,
  audit_design: auditDesignTool,
  arrange_artboards: arrangeArtboardsTool,
  set_artboard_background: setArtboardBackgroundTool,
  screenshot_artboard: screenshotArtboardTool,
  apply_theme: applyThemeTool,
  list_tokens: listTokensTool,
  set_tokens: setTokensTool,
  extract_component: extractComponentTool,
  update_component: updateComponentTool,
  list_components: listComponentsTool,
  list_assets: listAssetsTool,
  save_attachment_as_asset: saveAttachmentAsAssetTool,
  connect_artboards: connectArtboardsTool,
  disconnect_artboards: disconnectArtboardsTool,
  list_flows: listFlowsTool,
  diff_artboards: diffArtboardsTool,
  export_jsx: exportJsxTool,
  // Designer workflow tools: consistency, reuse, grids.
  find_and_replace: findAndReplaceTool,
  analyze_consistency: analyzeConsistencyTool,
  suggest_components: suggestComponentsTool,
  set_grid: setGridTool,
};
