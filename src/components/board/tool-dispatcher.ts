"use client";

/**
 * Tool dispatcher for the board chat.
 *
 * `chat.tsx` doesn't reach into the canvas directly — it hands a
 * `CanvasEditorHandle` to this module and asks "please run this tool
 * against the canvas". The dispatcher knows the set of valid tool
 * names and routes each one to its `executeXxx` implementation.
 *
 * Pre-Phase 4 this file branched on `handle.engine` to route to one
 * of two engines. After Phase 4 there's only Excalidraw, so the
 * outer dispatch is a single switch. The indirection layer is kept
 * anyway — it's a single small file that lets us re-introduce a
 * second engine, or A/B a new tool implementation, without touching
 * `chat.tsx`.
 */

import type { CanvasEditorHandle } from "./editor-context";
import type { ToolResult } from "@/lib/tool-result";

import * as excalidrawTools from "./excalidraw/canvas-tools";

export type CanvasToolName =
  | "query_canvas"
  | "find_shapes"
  | "query_neighborhood"
  | "get_connections"
  | "find_free_space"
  | "query_frame"
  | "add_shapes"
  | "connect_shapes"
  | "connect_many"
  | "relabel_arrows"
  | "align_shapes"
  | "distribute_shapes"
  | "group_into_frame"
  | "layout_shapes"
  | "duplicate_shapes"
  | "update_shapes"
  | "delete_shapes"
  | "analyze_canvas"
  | "explain_diagram"
  | "insert_template"
  | "add_image"
  | "add_markdown_card"
  | "add_mermaid_card"
  | "set_selection"
  | "focus_camera"
  | "screenshot_canvas";

/**
 * Dispatch a single tool call against the mounted Excalidraw canvas.
 *
 * Returns a `Promise` even for sync executors so the call site can
 * `await` uniformly — the only genuinely async tool is
 * `add_mermaid_card` (Mermaid parse is async).
 */
export async function dispatchCanvasTool(
  handle: CanvasEditorHandle,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
): Promise<ToolResult<unknown>> {
  const api = handle.api;
  switch (toolName as CanvasToolName) {
    case "query_canvas":
      return excalidrawTools.executeQueryCanvas(api, input);
    case "find_shapes":
      return excalidrawTools.executeFindShapes(api, input);
    case "query_neighborhood":
      return excalidrawTools.executeQueryNeighborhood(api, input);
    case "get_connections":
      return excalidrawTools.executeGetConnections(api, input);
    case "find_free_space":
      return excalidrawTools.executeFindFreeSpace(api, input);
    case "query_frame":
      return excalidrawTools.executeQueryFrame(api, input);
    case "add_shapes":
      return excalidrawTools.executeAddShapes(api, input);
    case "connect_shapes":
      return excalidrawTools.executeConnectShapes(api, input);
    case "connect_many":
      return excalidrawTools.executeConnectMany(api, input);
    case "relabel_arrows":
      return excalidrawTools.executeRelabelArrows(api, input);
    case "align_shapes":
      return excalidrawTools.executeAlignShapes(api, input);
    case "distribute_shapes":
      return excalidrawTools.executeDistributeShapes(api, input);
    case "group_into_frame":
      return excalidrawTools.executeGroupIntoFrame(api, input);
    case "layout_shapes":
      return excalidrawTools.executeLayoutShapes(api, input);
    case "duplicate_shapes":
      return excalidrawTools.executeDuplicateShapes(api, input);
    case "update_shapes":
      return excalidrawTools.executeUpdateShapes(api, input);
    case "delete_shapes":
      return excalidrawTools.executeDeleteShapes(api, input);
    case "analyze_canvas":
      return excalidrawTools.executeAnalyzeCanvas(api, input);
    case "explain_diagram":
      return excalidrawTools.executeExplainDiagram(api, input);
    case "insert_template":
      return excalidrawTools.executeInsertTemplate(api, input);
    case "add_image":
      return excalidrawTools.executeAddImage(api, input);
    case "add_markdown_card":
      return excalidrawTools.executeAddMarkdownCard(api, input);
    case "add_mermaid_card":
      return excalidrawTools.executeAddMermaidCard(api, input);
    case "set_selection":
      return excalidrawTools.executeSetSelection(api, input);
    case "focus_camera":
      return excalidrawTools.executeFocusCamera(api, input);
    case "screenshot_canvas":
      return excalidrawTools.executeScreenshotCanvas(api, input);
    default:
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Unknown tool: ${toolName}`,
        },
      };
  }
}
