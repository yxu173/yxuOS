"use client";

import { Tldraw, type Editor, type TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";

import { customShapeUtils } from "./shapes";

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
