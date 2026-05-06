"use client";

import { Tldraw, type Editor, type TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";

import { saveBoardSnapshot } from "@/app/(app)/boards/actions";

import { DevShapeToolbar } from "./dev-shape-toolbar";
import { useBoardEditorRef } from "./editor-context";
import { customShapeUtils } from "./shapes";

const SAVE_DEBOUNCE_MS = 1500;

export interface TldrawCanvasProps {
  boardId: string;
  initialSnapshot: Record<string, unknown> | null;
}

/**
 * Real <Tldraw> mount.
 *
 * - `snapshot` prop pre-populates the store from the row we read on the
 *   server. Supplying it here is cheaper than calling `loadStoreSnapshot`
 *   in `onMount` (no flash of empty canvas).
 * - We listen to user-driven document changes and debounce a server-action
 *   save back to Postgres. On unmount we flush whatever is pending so the
 *   tab navigate doesn't drop the last 1.5s of edits.
 */
export function TldrawCanvas({ boardId, initialSnapshot }: TldrawCanvasProps) {
  const editorRef = useBoardEditorRef();

  const handleMount = (editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: "dark" });
    editorRef.current = editor;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const snapshot = editor.store.getStoreSnapshot();
      saveBoardSnapshot(
        boardId,
        snapshot as unknown as Record<string, unknown>,
      ).catch((error) => {
        console.error("Failed to save board:", error);
      });
    };

    const unsubscribe = editor.store.listen(
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
      },
      { source: "user", scope: "document" },
    );

    return () => {
      if (timer) {
        clearTimeout(timer);
        // Last-chance save before the editor goes away.
        flush();
      }
      unsubscribe();
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  };

  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={
          initialSnapshot
            ? (initialSnapshot as unknown as TLStoreSnapshot)
            : undefined
        }
        onMount={handleMount}
      >
        {process.env.NEXT_PUBLIC_SHOW_DEV_TOOLBAR ? (
          <DevShapeToolbar />
        ) : null}
      </Tldraw>
    </div>
  );
}
