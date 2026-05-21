"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface PresentationDialogProps {
  api: ExcalidrawImperativeAPI;
  onClose: () => void;
}

/**
 * Fullscreen presentation mode that frames each Excalidraw shape one at
 * a time. Navigate with arrow keys or on-screen buttons. Press Escape
 * or click the close button to exit.
 *
 * Shapes are sorted by approximate reading order: top-to-bottom,
 * left-to-right.
 */
export function PresentationDialog({
  api,
  onClose,
}: PresentationDialogProps) {
  const elements = useMemo(() => {
    const all = api.getSceneElements() as NonDeletedExcalidrawElement[];
    // Filter out deleted elements and sort by reading order (y first, then x)
    return all
      .filter((el) => !el.isDeleted)
      .sort((a, b) => {
        const aY = a.y + a.height / 2;
        const bY = b.y + b.height / 2;
        if (Math.abs(aY - bY) < 50) return a.x - b.x;
        return aY - bY;
      });
  }, [api]);

  const [index, setIndex] = useState(0);
  const originalCamera = useRef(api.getAppState());

  const frame = useCallback(
    (el: NonDeletedExcalidrawElement) => {
      api.scrollToContent(el, {
        animate: true,
        duration: 300,
        fitToContent: true,
      });
    },
    [api],
  );

  // Frame the first shape on mount, restore camera on unmount
  useEffect(() => {
    const prev = originalCamera.current;
    if (elements.length > 0) frame(elements[0]);

    return () => {
      api.updateScene({
        appState: {
          scrollX: prev.scrollX,
          scrollY: prev.scrollY,
          zoom: prev.zoom,
        },
      });
    };
  }, [elements, frame, api]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((i) => {
          const next = Math.min(i + 1, elements.length - 1);
          frame(elements[next]);
          return next;
        });
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((i) => {
          const prev = Math.max(i - 1, 0);
          frame(elements[prev]);
          return prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [elements, frame, onClose]);

  const goTo = (i: number) => {
    if (i < 0 || i >= elements.length) return;
    setIndex(i);
    frame(elements[i]);
  };

  const current = elements[index];
  const label = current ? elementLabel(current) : "";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-3">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="font-mono tabular-nums">
            {index + 1}
            <span className="text-zinc-600"> / {elements.length}</span>
          </span>
          {label ? <span className="text-zinc-500">{label}</span> : null}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Exit presentation"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Canvas area — Excalidraw handles the actual rendering */}
      <div className="relative flex-1" />

      {/* Bottom bar — navigation */}
      <div className="flex h-12 shrink-0 items-center justify-center gap-4 border-t border-white/5 px-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          <ChevronLeft className="mr-1 size-4" />
          Previous
        </Button>
        <span className="hidden text-xs text-zinc-600 sm:inline">
          Use arrow keys to navigate
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goTo(index + 1)}
          disabled={index === elements.length - 1}
        >
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function elementLabel(el: NonDeletedExcalidrawElement): string {
  if (el.type === "text" && el.text) {
    const t = el.text.trim().replace(/\n/g, " ");
    return t.length > 40 ? `${t.slice(0, 40)}…` : t;
  }
  if (el.type === "frame" && el.name) return el.name;
  return el.type.charAt(0).toUpperCase() + el.type.slice(1);
}
