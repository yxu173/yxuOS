"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "tldraw";

interface EditorContextValue {
  editorRef: RefObject<Editor | null>;
  selectedShapeIds: readonly string[];
  setSelectedShapeIds: (ids: readonly string[]) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Holds a *ref* to the live tldraw `Editor` so the chat panel can call into
 * the canvas without forcing re-renders of either side, plus a *state*
 * mirror of the user's current selection so React-tree consumers (like the
 * comments panel) can re-render when it changes.
 *
 * The TldrawCanvas wires both up in `onMount`: it parks the editor in the
 * ref and subscribes to selection changes, calling `setSelectedShapeIds`.
 */
export function EditorRefProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Editor | null>(null);
  const [selectedShapeIds, setSelectedShapeIdsState] = useState<
    readonly string[]
  >([]);

  // Memoised so consumers that pass it through useEffect deps don't churn.
  const setSelectedShapeIds = useCallback((ids: readonly string[]) => {
    setSelectedShapeIdsState((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids,
    );
  }, []);

  return (
    <EditorContext.Provider
      value={{
        editorRef: ref,
        selectedShapeIds,
        setSelectedShapeIds,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

function useBoardEditorContext() {
  const value = useContext(EditorContext);
  if (!value) {
    throw new Error("Board editor hooks must be used inside <EditorRefProvider>");
  }
  return value;
}

export function useBoardEditorRef() {
  return useBoardEditorContext().editorRef;
}

/** Reactive view of the user's current tldraw selection — re-renders on change. */
export function useBoardSelection(): {
  selectedShapeIds: readonly string[];
} {
  const { selectedShapeIds } = useBoardEditorContext();
  return { selectedShapeIds };
}

/** Internal hook for TldrawCanvas — used to push selection updates back into context. */
export function useBoardSelectionWriter() {
  return useBoardEditorContext().setSelectedShapeIds;
}
