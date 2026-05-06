"use client";

import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";

export interface TldrawCanvasProps {
  boardId: string;
}

/**
 * Real <Tldraw> mount.
 *
 * - `persistenceKey` keeps the per-board canvas in IndexedDB until step 3
 *   replaces it with server-side snapshot persistence.
 * - We force dark mode via user preferences on mount so the canvas matches
 *   the rest of the app's dark chrome.
 * - `<Tldraw>` ships its own toolbar / menu / colour pickers — that's the
 *   "manual draw" surface. The Made-with-tldraw watermark is the free-tier
 *   licence requirement.
 */
export function TldrawCanvas({ boardId }: TldrawCanvasProps) {
  const handleMount = (editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: "dark" });
  };

  return (
    <div className="fixed inset-0">
      <Tldraw
        persistenceKey={`yxuos-board-${boardId}`}
        onMount={handleMount}
      />
    </div>
  );
}
