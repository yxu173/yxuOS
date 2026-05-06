"use client";

import { createShapeId, useEditor } from "tldraw";

import { Button } from "@/components/ui/button";

const DEFAULT_DIMENSIONS = {
  "markdown-card": { w: 320, h: 200 },
  "mermaid-card": { w: 480, h: 280 },
} as const;

type CustomShapeType = keyof typeof DEFAULT_DIMENSIONS;

/**
 * Temporary chrome for inserting custom cards while we don't have the
 * agent yet. The agent (step 7) will use the same `editor.createShape`
 * call from a server-side tool, so anything that works here will work
 * for the agent too.
 */
export function DevShapeToolbar() {
  const editor = useEditor();

  const insert = (type: CustomShapeType) => {
    const { w, h } = DEFAULT_DIMENSIONS[type];
    const center = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape({
      id,
      type,
      x: center.x - w / 2,
      y: center.y - h / 2,
    });
    editor.select(id);
    editor.setEditingShape(id);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[400] flex justify-center">
      <div className="pointer-events-auto flex gap-1 rounded-lg border border-white/10 bg-black/60 p-1 backdrop-blur">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => insert("markdown-card")}
          className="text-zinc-200 hover:text-white"
        >
          + Markdown
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => insert("mermaid-card")}
          className="text-zinc-200 hover:text-white"
        >
          + Mermaid
        </Button>
      </div>
    </div>
  );
}
