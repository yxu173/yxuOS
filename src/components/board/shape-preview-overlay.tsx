"use client";

import { EyeIcon } from "lucide-react";
import { useState } from "react";
import { useEditor, useValue } from "tldraw";

import {
  ShapePreviewDialog,
  type ShapePreviewKind,
} from "./shape-preview-dialog";
import type { MarkdownCardShape } from "./shapes/markdown-card";
import type { MermaidCardShape } from "./shapes/mermaid-card";

type PreviewableShape = MarkdownCardShape | MermaidCardShape;

/**
 * Floating "Preview" button anchored above the currently selected
 * markdown or mermaid card. Renders inside tldraw's
 * `InFrontOfTheCanvas` slot so it follows pan/zoom automatically — we
 * just convert the shape's page-space top-center to viewport space and
 * drop the button there.
 *
 * Hidden when:
 * - nothing or multiple shapes are selected
 * - the selected shape isn't a previewable card type
 * - the user is currently editing the shape (textarea is up)
 *
 * The dialog state lives here so closing it doesn't leak through to a
 * parent that would try to keep it in sync with selection.
 */
export function ShapePreviewOverlay() {
  const editor = useEditor();
  const [preview, setPreview] = useState<ShapePreviewKind | null>(null);

  // useValue re-runs on every store change; we narrow it down to the
  // pieces we actually need to keep the button position in sync.
  const anchor = useValue(
    "shape-preview anchor",
    () => {
      const selected = editor.getSelectedShapeIds();
      if (selected.length !== 1) return null;
      const shapeId = selected[0]!;
      if (editor.getEditingShapeId() === shapeId) return null;

      const shape = editor.getShape(shapeId);
      if (!shape) return null;
      if (shape.type !== "markdown-card" && shape.type !== "mermaid-card") {
        return null;
      }

      const bounds = editor.getShapePageBounds(shapeId);
      if (!bounds) return null;
      // Anchor at the top-center of the shape, in viewport coords.
      const top = editor.pageToViewport({ x: bounds.midX, y: bounds.minY });
      const previewShape = shape as PreviewableShape;
      return {
        x: top.x,
        y: top.y,
        shape: previewShape,
      };
    },
    [editor],
  );

  const openPreview = () => {
    if (!anchor) return;
    const { shape } = anchor;
    if (shape.type === "markdown-card") {
      setPreview({ type: "markdown", markdown: shape.props.markdown });
    } else {
      setPreview({
        type: "mermaid",
        mermaid: shape.props.mermaid,
        shapeId: shape.id,
      });
    }
  };

  return (
    <>
      {anchor ? (
        <button
          type="button"
          onPointerDown={(event) => {
            // Don't let tldraw treat this as a canvas pointer event
            // (would deselect / start a drag).
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            openPreview();
          }}
          className="pointer-events-auto absolute z-[300] inline-flex -translate-x-1/2 -translate-y-[calc(100%+8px)] items-center gap-1.5 rounded-md border border-white/15 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-100 shadow-md backdrop-blur transition hover:border-white/25 hover:bg-zinc-800/90"
          style={{ left: anchor.x, top: anchor.y }}
        >
          <EyeIcon className="size-3.5" aria-hidden />
          Preview
        </button>
      ) : null}
      <ShapePreviewDialog
        preview={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </>
  );
}
