"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  useValue,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

export type MarkdownCardShape = TLBaseShape<
  "markdown-card",
  {
    w: number;
    h: number;
    markdown: string;
  }
>;

const markdownCardProps: RecordProps<MarkdownCardShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  markdown: T.string,
};

const DEFAULT_MARKDOWN = `# New note

Double-click to edit.`;

/**
 * Custom tldraw shape that renders a markdown block.
 *
 * - In display mode: react-markdown + remark-gfm renders the prose.
 * - In edit mode: a textarea bound to `shape.props.markdown`.
 * - Inherits `getGeometry` / `onResize` / `getInterpolatedProps` from
 *   `BaseBoxShapeUtil` since the shape is just a {w, h} box.
 */
export class MarkdownCardShapeUtil extends BaseBoxShapeUtil<MarkdownCardShape> {
  static override type = "markdown-card" as const;
  static override props = markdownCardProps;

  override getDefaultProps(): MarkdownCardShape["props"] {
    return {
      w: 320,
      h: 200,
      markdown: DEFAULT_MARKDOWN,
    };
  }

  override canEdit() {
    return true;
  }

  override component(shape: MarkdownCardShape) {
    return <MarkdownCardComponent shape={shape} />;
  }

  override indicator(shape: MarkdownCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function MarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "markdown-card isEditing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );

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
          value={shape.props.markdown}
          onChange={(event) => {
            editor.updateShape<MarkdownCardShape>({
              id: shape.id,
              type: shape.type,
              props: { markdown: event.target.value },
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
      ) : (
        <div
          style={{
            padding: "14px 16px",
            overflow: "hidden",
            color: "var(--tl-color-text, #f5f5f5)",
            font: "14px/1.55 var(--tl-font-sans, ui-sans-serif, system-ui)",
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {shape.props.markdown}
          </ReactMarkdown>
        </div>
      )}
    </HTMLContainer>
  );
}
