"use client";

import { useEffect, useState } from "react";

import { MarkdownProse } from "@/components/markdown/markdown-prose";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { renderMermaid } from "./mermaid";

/**
 * Full-size, read-only preview for a single board card. The on-canvas
 * shape is constrained to whatever box the user (or agent) drew, which
 * makes long markdown notes scroll inside a 320×200 frame and mermaid
 * diagrams render tiny. This dialog re-renders the same content at up
 * to 90vw × 85vh so it can actually be read.
 *
 * Re-renders mermaid each time the dialog opens (or the source changes)
 * because the SVG is tied to its viewport — the on-card SVG is sized
 * for ~480×280 and would look pixelated when blown up.
 */
export type ShapePreviewKind =
  | { type: "markdown"; markdown: string }
  | { type: "mermaid"; mermaid: string; shapeId: string };

export interface ShapePreviewDialogProps {
  /** `null` = closed. */
  preview: ShapePreviewKind | null;
  onOpenChange: (open: boolean) => void;
}

export function ShapePreviewDialog({
  preview,
  onOpenChange,
}: ShapePreviewDialogProps) {
  const open = preview !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[90vw] max-w-[1100px] flex-col gap-0 overflow-hidden bg-zinc-950/95 p-0 sm:max-w-[1100px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">
          {preview?.type === "mermaid" ? "Diagram preview" : "Note preview"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Full-size preview of the selected board card.
        </DialogDescription>
        {preview?.type === "markdown" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            <MarkdownProse className="text-base leading-relaxed">
              {preview.markdown || "_(empty)_"}
            </MarkdownProse>
          </div>
        ) : preview?.type === "mermaid" ? (
          <MermaidPreview shapeId={preview.shapeId} source={preview.mermaid} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type MermaidResult =
  | { kind: "ok"; svg: string }
  | { kind: "err"; message: string };

function MermaidPreview({
  shapeId,
  source,
}: {
  shapeId: string;
  source: string;
}) {
  // Tag results with the source they came from so we never show a stale
  // SVG (and don't have to clear state synchronously inside the effect,
  // which the react-hooks rules rightly flag).
  const [result, setResult] = useState<
    (MermaidResult & { source: string }) | null
  >(null);
  const isStale = result === null || result.source !== source;
  const error = !isStale && result?.kind === "err" ? result.message : null;
  const svg = !isStale && result?.kind === "ok" ? result.svg : null;

  useEffect(() => {
    let cancelled = false;
    // Distinct render id from the on-card SVG so mermaid doesn't reuse
    // the cached one — important because the dialog SVG is sized to its
    // own container.
    const safeId = `mermaid-preview-${shapeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    renderMermaid(safeId, source)
      .then((rendered) => {
        if (cancelled) return;
        setResult({ kind: "ok", svg: rendered, source });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          kind: "err",
          message:
            err instanceof Error ? err.message : "Mermaid render failed",
          source,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [shapeId, source]);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-7">
        <pre className="max-w-full overflow-auto rounded-md border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-300">
          {`Mermaid error\n\n${error}`}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-400">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="[&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-full [&_svg]:max-w-full flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
      // mermaid produces trusted SVG (securityLevel: 'loose' but it
      // sanitizes user-supplied source). Same trust boundary as the
      // on-canvas card.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
