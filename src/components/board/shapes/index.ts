import { MarkdownCardShapeUtil } from "./markdown-card";
import { MermaidCardShapeUtil } from "./mermaid-card";

/**
 * Augment tldraw's global shape registry so `TLShape` / `TLBaseBoxShape`
 * recognize our custom shapes everywhere in the type system. Without this,
 * `extends BaseBoxShapeUtil<MarkdownCardShape>` and `editor.createShape({
 * type: "markdown-card", ... })` raise type errors because `TLShape` is
 * otherwise a closed union of the built-in shape types.
 */
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "markdown-card": {
      w: number;
      h: number;
      markdown: string;
    };
    "mermaid-card": {
      w: number;
      h: number;
      mermaid: string;
      kind: string;
    };
  }
}

export { MarkdownCardShapeUtil, MermaidCardShapeUtil };
export type { MarkdownCardShape } from "./markdown-card";
export type { MermaidCardShape } from "./mermaid-card";

/**
 * Every custom shape we register on the tldraw editor.
 * Pass this directly to `<Tldraw shapeUtils={customShapeUtils} />`.
 */
export const customShapeUtils = [MarkdownCardShapeUtil, MermaidCardShapeUtil];
