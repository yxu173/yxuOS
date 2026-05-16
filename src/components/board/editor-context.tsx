"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Live handle to the mounted Excalidraw canvas. Used as a ref so the
 * chat panel and other peers can call into the canvas without forcing
 * re-renders of either side.
 *
 * Pre-Phase 4 this was a tagged union (`{engine: "tldraw", editor} |
 * {engine: "excalidraw", api}`) so the dispatcher could route to the
 * right engine. Phase 4 dropped tldraw entirely, so the union
 * collapsed to its single survivor. If you're re-introducing a
 * second engine, restore the union here, in `tool-dispatcher.ts`,
 * and in the helpers below.
 */
export interface CanvasEditorHandle {
  readonly api: ExcalidrawImperativeAPI;
}

interface EditorContextValue {
  handleRef: RefObject<CanvasEditorHandle | null>;
  selectedShapeIds: readonly string[];
  setSelectedShapeIds: (ids: readonly string[]) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Holds a *ref* to the live canvas handle so the chat panel can call
 * into the canvas without forcing re-renders of either side, plus a
 * *state* mirror of the user's current selection so React-tree
 * consumers (the comments panel, the right rail) can re-render when
 * it changes.
 *
 * The Excalidraw canvas wires both up on mount: it writes the
 * imperative API into `handleRef` via the `excalidrawAPI` callback,
 * and its `onChange` handler pushes the selection here.
 */
export function EditorRefProvider({ children }: { children: ReactNode }) {
  const ref = useRef<CanvasEditorHandle | null>(null);
  const [selectedShapeIds, setSelectedShapeIdsState] = useState<
    readonly string[]
  >([]);

  // Memoised so consumers that pass it through useEffect deps don't
  // churn. The identity comparison short-circuits the common case
  // where Excalidraw fires `onChange` with an unchanged selection.
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
        handleRef: ref,
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

/** Live handle to the mounted Excalidraw canvas, or `null` before mount. */
export function useBoardCanvasHandle() {
  return useBoardEditorContext().handleRef;
}

/** Reactive view of the user's current canvas selection — re-renders on change. */
export function useBoardSelection(): {
  selectedShapeIds: readonly string[];
} {
  const { selectedShapeIds } = useBoardEditorContext();
  return { selectedShapeIds };
}

/** Internal hook used by the canvas to push selection updates back into context. */
export function useBoardSelectionWriter() {
  return useBoardEditorContext().setSelectedShapeIds;
}

/* ─── canvas helpers ─────────────────────────────────────
 *
 * These were engine-neutral pre-Phase 4; now they're thin wrappers
 * around the Excalidraw imperative API. Kept as standalone exports
 * because the board shell calls them from a handful of UI hooks
 * (focus a shape, clear selection, read a label for the comments
 * rail) and the indirection lets us swap the implementation again
 * if needed.
 */

export function selectNone(handle: CanvasEditorHandle | null): void {
  if (!handle) return;
  // Empty out `selectedElementIds`. Camera is preserved.
  handle.api.updateScene({
    appState: { selectedElementIds: {} },
  });
}

export function focusShape(
  handle: CanvasEditorHandle | null,
  shapeId: string,
): void {
  if (!handle) return;
  const target = handle.api
    .getSceneElements()
    .find((el) => el.id === shapeId);
  if (!target) return;
  handle.api.updateScene({
    appState: { selectedElementIds: { [target.id]: true } },
  });
  handle.api.scrollToContent(target, {
    animate: true,
    duration: 200,
    fitToContent: true,
  });
}

export function readShapeLabel(
  handle: CanvasEditorHandle | null,
  shapeId: string,
): string {
  if (!handle) return "shape";
  const element = handle.api
    .getSceneElements()
    .find((el) => el.id === shapeId);
  if (!element) return "deleted shape";
  // Text elements carry their string in `.text`. Frames have `.name`.
  // Other elements can have a bound text label (a child text element
  // whose `containerId === element.id`); we look that up when needed.
  if (element.type === "text" && element.text.trim()) {
    return truncateLabel(element.text);
  }
  if (element.type === "frame" && element.name?.trim()) {
    return truncateLabel(element.name);
  }
  const boundText = element.boundElements?.find((b) => b.type === "text");
  if (boundText) {
    const labelEl = handle.api
      .getSceneElements()
      .find((el) => el.id === boundText.id);
    if (labelEl && labelEl.type === "text" && labelEl.text.trim()) {
      return truncateLabel(labelEl.text);
    }
  }
  return element.type;
}

function truncateLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}
