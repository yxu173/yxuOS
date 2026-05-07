"use client";

import {
  Tldraw,
  type Editor,
  type TLComponents,
  type TLStoreSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";

import { ShapePreviewOverlay } from "./shape-preview-overlay";
import { customShapeUtils } from "./shapes";

// See tldraw-canvas.tsx — module scope keeps the slot stable.
const tldrawComponents: TLComponents = {
  InFrontOfTheCanvas: ShapePreviewOverlay,
};

export interface ReadonlyTldrawCanvasProps {
  snapshot: Record<string, unknown> | null;
}

export function ReadonlyTldrawCanvas({ snapshot }: ReadonlyTldrawCanvasProps) {
  const handleMount = (editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: "dark" });
    editor.updateInstanceState({ isReadonly: true });
  };

  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={customShapeUtils}
        components={tldrawComponents}
        snapshot={
          snapshot
            ? (snapshot as unknown as TLStoreSnapshot)
            : undefined
        }
        onMount={handleMount}
      />
    </div>
  );
}
