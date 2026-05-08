"use client";

import { Crosshair, X } from "lucide-react";

import { useDesignCanvas } from "./canvas-store";
import { findNodeInTree, nodeLabel } from "./node-utils";

/**
 * "Pinned elements" chip row that lives above the chat composer.
 *
 * Reads `selectedNodeIds` from the canvas store and renders one chip
 * per pick. Each chip shows a friendly label and an X to remove it.
 * Clicking a chip's body re-selects ONLY that node (replaces the set)
 * — the agent can keep multi-select alive when the user wants it but
 * "click to focus" still works as a quick collapse.
 *
 * On send (in design-chat.tsx) every chip becomes part of the
 * outgoing payload: a JSON header text part identifies them by id +
 * a per-node PNG screenshot lets the model SEE what the user pinned.
 *
 * This bar renders nothing when no elements are pinned, so it doesn't
 * take up any space in the common case.
 */
export function PinnedElementsBar() {
  const selectedNodeIds = useDesignCanvas((s) => s.selectedNodeIds);
  const artboards = useDesignCanvas((s) => s.artboards);
  const selectNode = useDesignCanvas((s) => s.selectNode);
  const clearNodeSelection = useDesignCanvas((s) => s.clearNodeSelection);

  if (selectedNodeIds.length === 0) return null;

  // Resolve each id to its label + artboard name. Missing ids
  // (deleted between pick and render) are filtered out — staleness
  // is rare since deleteNodeInArtboard already prunes the array.
  const chips = selectedNodeIds
    .map((id) => {
      for (const ab of artboards) {
        if (!ab.design) continue;
        const node = findNodeInTree(ab.design, id);
        if (node) {
          return {
            id,
            artboardId: ab.id,
            artboardName: ab.name,
            label: nodeLabel(node),
          };
        }
      }
      return null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        <Crosshair className="size-3" />
        Pinned
      </span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => selectNode(chip.id)}
          title={`${chip.artboardName} · ${chip.label}`}
          // Hover affordance is a button outline; the chip itself
          // re-selects the single node (collapses multi-pick to
          // just this one). Removing requires the X icon — gives
          // users a way to drop one without losing the whole set.
          className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 py-0.5 pl-2 pr-1 text-[11px] text-blue-200 transition-colors hover:border-blue-400/50 hover:bg-blue-500/15"
        >
          <span className="truncate" aria-label={chip.label}>
            {chip.label}
          </span>
          <span
            role="button"
            tabIndex={-1}
            aria-label="Remove pinned element"
            onClick={(event) => {
              // Stop the parent button (re-select). Toggle this id
              // in/out via additive=true; since it's currently in
              // the set, that drops it.
              event.stopPropagation();
              event.preventDefault();
              selectNode(chip.id, true);
            }}
            className="grid size-3.5 place-items-center rounded-sm text-blue-300/70 transition-colors hover:bg-blue-500/30 hover:text-blue-100"
          >
            <X className="size-2.5" />
          </span>
        </button>
      ))}
      {chips.length > 1 ? (
        <button
          type="button"
          onClick={clearNodeSelection}
          className="ml-1 text-[10px] uppercase tracking-wide text-zinc-500 transition-colors hover:text-zinc-300"
          title="Clear all pinned elements"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
