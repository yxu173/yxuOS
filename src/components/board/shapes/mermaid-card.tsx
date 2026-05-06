"use client";

import { useEffect, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  useValue,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

import { renderMermaid } from "../mermaid";

export type MermaidCardShape = TLBaseShape<
  "mermaid-card",
  {
    w: number;
    h: number;
    mermaid: string;
    kind: string;
  }
>;

const mermaidCardProps: RecordProps<MermaidCardShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  mermaid: T.string,
  kind: T.string,
};

const DEFAULT_MERMAID = `flowchart LR
  A[Client] --> B(Server)
  B --> C[(Database)]`;

/**
 * Custom tldraw shape that renders a Mermaid diagram.
 *
 * - In display mode: lazy-loaded Mermaid renders the source to inline SVG.
 * - In edit mode: a textarea exposes the Mermaid source for tweaking.
 * - Mermaid (~600 KB) is dynamically imported inside the component, so it
 *   only ships when a card actually mounts.
 */
export class MermaidCardShapeUtil extends BaseBoxShapeUtil<MermaidCardShape> {
  static override type = "mermaid-card" as const;
  static override props = mermaidCardProps;

  override getDefaultProps(): MermaidCardShape["props"] {
    return {
      w: 480,
      h: 280,
      mermaid: DEFAULT_MERMAID,
      kind: "flowchart",
    };
  }

  override canEdit() {
    return true;
  }

  override component(shape: MermaidCardShape) {
    return <MermaidCardComponent shape={shape} />;
  }

  override indicator(shape: MermaidCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function MermaidCardComponent({ shape }: { shape: MermaidCardShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "mermaid-card isEditing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const safeId = `mermaid-${shape.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    renderMermaid(safeId, shape.props.mermaid)
      .then((rendered) => {
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Mermaid render failed");
        setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shape.id, shape.props.mermaid]);

  return (
    <HTMLContainer
      className="animate-in fade-in zoom-in-95 duration-300"
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: isEditing ? "all" : "none",
        borderRadius: 12,
        border: "1px solid color-mix(in oklch, white 12%, transparent)",
        background: "color-mix(in oklch, black 65%, transparent)",
        backdropFilter: "blur(12px)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {isEditing ? (
        <textarea
          autoFocus
          spellCheck={false}
          value={shape.props.mermaid}
          onChange={(event) => {
            editor.updateShape<MermaidCardShape>({
              id: shape.id,
              type: shape.type,
              props: { mermaid: event.target.value },
            });
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              editor.setEditingShape(null);
            }
            event.stopPropagation();
          }}
          style={{
            width: "100%",
            height: "100%",
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--tl-color-text, #f5f5f5)",
            font: "13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
            padding: "14px 16px",
          }}
        />
      ) : error ? (
        <div
          style={{
            padding: "14px 16px",
            color: "#fca5a5",
            font: "13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {`Mermaid error\n\n${error}`}
        </div>
      ) : svg ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 14,
            overflow: "hidden",
          }}
          // mermaid renders trusted SVG (we set securityLevel: 'loose' above);
          // user-supplied source can include script-ish tags but mermaid
          // sanitizes them.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: "grid",
            placeItems: "center",
            color: "color-mix(in oklch, white 50%, transparent)",
            font: "12px/1.55 ui-sans-serif, system-ui",
          }}
        >
          Rendering diagram…
        </div>
      )}
    </HTMLContainer>
  );
}
