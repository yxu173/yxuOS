"use client";

import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { createRoot, type Root } from "react-dom/client";
import { createElement, type ComponentType } from "react";

import {
  BoardMentionList,
  type BoardMentionItem,
  type BoardMentionListHandle,
  type BoardMentionListProps,
} from "./board-mention-suggestion";

/**
 * Configuration the consumer (the design-chat composer) supplies to
 * the Mention extension factory below. Kept tiny on purpose:
 *
 *  - `searchBoards` — the network call (or anything else) that
 *    returns the suggestion items for a given query string. Wrapping
 *    it on the consumer side means tests can swap in a fake without
 *    intercepting fetch.
 *
 *  - `getSelectedIds` — read-only snapshot of which boards are
 *    already mentioned in the current message; the dropdown dims
 *    those rows and refuses to insert duplicates.
 *
 *  - `getCapReached` — `true` once the user has hit the per-message
 *    mention cap (3). The dropdown switches to a read-only
 *    "remove one to add another" notice in that state.
 */
export interface BoardMentionConfig {
  searchBoards: (query: string) => Promise<BoardMentionItem[]>;
  getSelectedIds: () => string[];
  getCapReached: () => boolean;
}

/**
 * Build a configured Mention extension instance for the design chat.
 *
 * - Trigger char: `@`.
 * - The popover is a React component rendered into a free-floating
 *   `<div>` we anchor to the caret rect each frame. We render with
 *   `react-dom/client`'s `createRoot` so the popover lives in its own
 *   React subtree, independent of the editor host.
 * - The mention node renders as `@<board-name>` in the editor and
 *   carries a `data-id` we read at submit time to build the
 *   `mentionedBoardIds` payload. (See `extractBoardMentions` in
 *   `design-chat.tsx`.)
 */
export function createBoardMentionExtension(config: BoardMentionConfig) {
  return Mention.configure({
    HTMLAttributes: {
      class:
        "mention-board inline-flex items-center rounded bg-zinc-700/60 px-1 py-0.5 text-zinc-100",
      "data-mention-kind": "board",
    },
    renderText({ node }) {
      const label = node.attrs.label ?? node.attrs.id ?? "";
      return `@${label}`;
    },
    deleteTriggerWithBackspace: true,
    suggestion: {
      char: "@",
      // Boards have spaces in their names ("Onboarding flow"), but
      // the popover already filters live — keeping this `false` means
      // the user types `@on`, picks the row, gets the chip. Allowing
      // spaces would force them to press Escape to escape the trigger
      // and ruin the freeform text experience.
      allowSpaces: false,
      // The standard Mention command — replaces the in-flight
      // suggestion text with a real `mention` node carrying our attrs.
      command: ({ editor, range, props }) => {
        const nodeAfter = editor.view.state.selection.$to.nodeAfter;
        const overrideSpace = nodeAfter?.text?.startsWith(" ");
        if (overrideSpace) {
          range.to += 1;
        }
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "mention",
              attrs: { id: props.id, label: props.label },
            },
            { type: "text", text: " " },
          ])
          .run();
      },
      items: async ({ query }) => {
        try {
          return await config.searchBoards(query);
        } catch {
          return [];
        }
      },
      render: () => {
        let renderer: SuggestionRenderer | null = null;

        return {
          onStart(props) {
            renderer = createSuggestionRenderer(props, config);
          },
          onUpdate(props) {
            renderer?.update(props);
          },
          onKeyDown(props) {
            if (props.event.key === "Escape") {
              renderer?.destroy();
              renderer = null;
              return false; // let the suggestion plugin close itself
            }
            return renderer?.onKeyDown(props) ?? false;
          },
          onExit() {
            renderer?.destroy();
            renderer = null;
          },
        };
      },
    },
  });
}

/* ─── Popover rendering ────────────────────────────────── */

interface SuggestionRenderer {
  update: (props: SuggestionProps<BoardMentionItem>) => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  destroy: () => void;
}

/**
 * Mount the React popover next to the caret. We re-position on every
 * `update` because the underlying `clientRect` ticks as the user
 * types (and tiptap's `decorationNode` may be null until the first
 * paint).
 */
function createSuggestionRenderer(
  initial: SuggestionProps<BoardMentionItem>,
  config: BoardMentionConfig,
): SuggestionRenderer {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.zIndex = "9999";
  host.style.pointerEvents = "auto";
  document.body.appendChild(host);

  const root: Root = createRoot(host);

  // ReactRenderer would normally manage this, but we already have a
  // root + host — we just use it as the imperative-handle holder so
  // we can forward key events to the list. (`ReactRenderer` exposes
  // `ref.current.onKeyDown` for the same reason; we bypass it to
  // keep the mounting story explicit.)
  const handleRef: { current: BoardMentionListHandle | null } = {
    current: null,
  };

  let latestProps = initial;
  const positionAndRender = (props: SuggestionProps<BoardMentionItem>) => {
    latestProps = props;
    const rect = props.clientRect?.();
    if (rect) {
      // Anchor below the caret with a small gap. Flip above when
      // there's not enough room below — keeps the popover on screen
      // for users typing near the bottom of the viewport.
      const popoverHeightEstimate = 220;
      const wouldOverflowBottom =
        rect.bottom + popoverHeightEstimate > window.innerHeight;
      const top = wouldOverflowBottom
        ? Math.max(8, rect.top - popoverHeightEstimate - 6)
        : rect.bottom + 6;
      host.style.left = `${Math.round(rect.left)}px`;
      host.style.top = `${Math.round(top)}px`;
    }
    const componentProps: BoardMentionListProps = {
      items: props.items,
      command: (attrs) => props.command(attrs),
      capReached: config.getCapReached(),
      selectedIds: config.getSelectedIds(),
    };
    root.render(
      createElement(
        BoardMentionListWithRef,
        {
          ...componentProps,
          forwardedRef: (h) => {
            handleRef.current = h;
          },
        },
      ),
    );
  };

  positionAndRender(initial);

  return {
    update: (props) => positionAndRender(props),
    onKeyDown: (props) =>
      handleRef.current?.onKeyDown({ event: props.event }) ?? false,
    destroy: () => {
      // Defer unmount to the next tick — calling root.unmount()
      // synchronously inside a tiptap callback can collide with
      // ProseMirror's transaction queue.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      // touch latestProps to keep ts-eslint quiet (closes over it via update).
      void latestProps;
    },
  };
}

/* ─── Forward-ref bridge ───────────────────────────────── */

/**
 * Tiny adapter so we can hand a callback ref through `createElement`
 * (the JSX-style `ref={…}` syntax is awkward here because we're
 * outside of JSX). The list itself uses `forwardRef`, so we route
 * `forwardedRef` → `ref` once and pass the rest through.
 */
const BoardMentionListWithRef: ComponentType<
  BoardMentionListProps & {
    forwardedRef: (h: BoardMentionListHandle | null) => void;
  }
> = ({ forwardedRef, ...rest }) =>
  createElement(BoardMentionList, { ...rest, ref: forwardedRef });

// Keep ReactRenderer in the type graph so a future refactor that
// migrates this file to use it doesn't have to re-add the import.
void ReactRenderer;
