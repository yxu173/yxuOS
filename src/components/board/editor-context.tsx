"use client";

import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "tldraw";

const EditorRefContext = createContext<RefObject<Editor | null> | null>(null);

/**
 * Holds a *ref* to the live tldraw `Editor` so the chat panel can call into
 * the canvas without forcing re-renders of either side. The TldrawCanvas
 * sets the ref in its `onMount` callback; the Chat reads it at tool-call
 * time.
 */
export function EditorRefProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Editor | null>(null);
  return (
    <EditorRefContext.Provider value={ref}>{children}</EditorRefContext.Provider>
  );
}

export function useBoardEditorRef() {
  const ref = useContext(EditorRefContext);
  if (!ref) {
    throw new Error("useBoardEditorRef must be used inside <EditorRefProvider>");
  }
  return ref;
}
