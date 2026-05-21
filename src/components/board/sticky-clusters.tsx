"use client";

import type {
  ExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { Layers, Ungroup } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useBoardCanvasHandle } from "./editor-context";

/**
 * Sticky note cluster manager. Shows a floating toolbar when multiple
 * shapes are selected, allowing grouping/ungrouping and bulk operations.
 *
 * Keyboard shortcuts:
 *   Ctrl/Cmd + G       → Group selection
 *   Ctrl/Cmd + Shift + G → Ungroup selection
 */
export function StickyClusters() {
  const handleRef = useBoardCanvasHandle();
  const [selectedCount, setSelectedCount] = useState(0);
  const pollRef = useRef<number | null>(null);

  // Poll selection from Excalidraw via the handle ref (avoids re-renders)
  useEffect(() => {
    let active = true;
    function tick() {
      if (!active) return;
      const handle = handleRef.current;
      if (handle) {
        const ids = Object.keys(
          handle.api.getAppState().selectedElementIds ?? {},
        );
        setSelectedCount(ids.length);
      }
      pollRef.current = requestAnimationFrame(tick);
    }
    pollRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (pollRef.current) cancelAnimationFrame(pollRef.current);
    };
  }, [handleRef]);


  const hasSelection = selectedCount >= 2;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const api = handleRef.current?.api && handleRef.current.api;
      if (!api) return;

      if (event.key === "g" || event.key === "G") {
        if (event.shiftKey) {
          event.preventDefault();
          const elements = api.getSceneElements() as ExcalidrawElement[];
          const selected = elements.filter((el) =>
            Object.keys(
              api.getAppState().selectedElementIds ?? {},
            ).includes(el.id),
          );
          const result = new Map<string, ExcalidrawElement>();
          for (const el of selected) {
            result.set(el.id, { ...el, groupIds: [] });
          }
          api.updateScene({
            elements: api.getSceneElements().map((el) => result.get(el.id) ?? el),
          });
        } else {
          event.preventDefault();
          const state = api.getAppState();
          const ids = Object.keys(state.selectedElementIds ?? {});
          if (ids.length >= 2) {
            const groupId = `grp-${Date.now().toString(36)}`;
            const idSet = new Set(ids);
            const elements = api.getSceneElements() as ExcalidrawElement[];
            const updated = elements.map((el) => {
              if (!idSet.has(el.id)) return el;
              return { ...el, groupIds: [...(el.groupIds ?? []), groupId] };
            });
            api.updateScene({ elements: updated });
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRef]);

  const group = () => {
    const api = handleRef.current?.api && handleRef.current.api;
    if (!api) return;
    const state = api.getAppState();
    const ids = Object.keys(state.selectedElementIds ?? {});
    if (ids.length < 2) return;
    const groupId = `grp-${Date.now().toString(36)}`;
    const idSet = new Set(ids);
    const elements = api.getSceneElements() as ExcalidrawElement[];
    const updated = elements.map((el) => {
      if (!idSet.has(el.id)) return el;
      return { ...el, groupIds: [...(el.groupIds ?? []), groupId] };
    });
    api.updateScene({ elements: updated });
  };

  const ungroup = () => {
    const api = handleRef.current?.api && handleRef.current.api;
    if (!api) return;
    const elements = api.getSceneElements() as ExcalidrawElement[];
    const selected = elements.filter((el) =>
      Object.keys(api.getAppState().selectedElementIds ?? {}).includes(el.id),
    );
    const result = new Map<string, ExcalidrawElement>();
    for (const el of selected) {
      result.set(el.id, { ...el, groupIds: [] });
    }
    api.updateScene({
      elements: api.getSceneElements().map((el) => result.get(el.id) ?? el),
    });
  };

  const selectGroup = () => {
    const api = handleRef.current?.api && handleRef.current.api;
    if (!api) return;
    const allElements = api.getSceneElements() as ExcalidrawElement[];
    const selectedSet = new Set(
      Object.keys(api.getAppState().selectedElementIds ?? {}),
    );
    const newSelection: Record<string, boolean> = {};

    for (const el of allElements) {
      if (el.groupIds && el.groupIds.length > 0) {
        for (const gid of el.groupIds) {
          const anyInGroup = allElements.some(
            (e) => e.groupIds?.includes(gid) && selectedSet.has(e.id),
          );
          if (anyInGroup) {
            newSelection[el.id] = true;
            break;
          }
        }
      }
    }

    if (Object.keys(newSelection).length > 0) {
      api.updateScene({
        appState: {
          selectedElementIds: newSelection as Record<string, true>,
        },
      });
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/90 px-3 py-2 shadow-2xl backdrop-blur transition-all duration-200",
        hasSelection
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "translate-y-2 opacity-0",
      )}
    >
      <span className="text-xs tabular-nums text-zinc-400">
        {selectedCount} selected
      </span>
      <div className="mx-1 h-4 w-px bg-white/10" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-zinc-300"
        onClick={group}
        title="Group selected shapes (Cmd+G)"
      >
        <Layers className="size-3.5" />
        Group
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-zinc-300"
        onClick={ungroup}
        title="Ungroup selected shapes (Cmd+Shift+G)"
      >
        <Ungroup className="size-3.5" />
        Ungroup
      </Button>
      <div className="mx-1 h-4 w-px bg-white/10" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-zinc-300"
        onClick={selectGroup}
        title="Select all shapes in the same group"
      >
        Select group
      </Button>
    </div>
  );
}
