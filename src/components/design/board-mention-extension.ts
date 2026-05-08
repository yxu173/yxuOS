"use client";

import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  BoardMentionList,
  type BoardMentionItem,
  type BoardMentionListHandle,
  type BoardMentionListProps,
  type MentionKind,
} from "./board-mention-suggestion";

/**
 * Configuration the consumer (the design-chat composer, the rich-text
 * editor) supplies to the Mention extension factory below. Kept tiny
 * on purpose:
 *
 *  - `searchBoards` — the network call (or anything else) that
 *    returns suggestion items for a query string. The name is
 *    historical; the items can now be of any {@link MentionKind}.
 *
 *  - `getSelectedIds` — read-only snapshot of which items are
 *    already mentioned in the current message. Dropdown dims those
 *    rows and refuses to insert duplicates.
 *
 *  - `getCapReached` — `true` once the user has hit the per-message
 *    mention cap. The dropdown switches to a read-only "remove one
 *    to add another" notice in that state.
 */
export interface BoardMentionConfig {
  searchBoards: (query: string) => Promise<BoardMentionItem[]>;
  getSelectedIds: () => string[];
  getCapReached: () => boolean;
}

/**
 * Build a configured Mention extension for any consumer.
 *
 * The mention node carries three attrs:
 *   - `id`    — opaque entity id (board / research note / plan).
 *   - `label` — the display name at insertion time. Used for
 *     `renderText` (`@<label>`) and as the visible chip text.
 *   - `kind`  — discriminator (`board`, `research`, `plan`). Persisted
 *     in the saved HTML as `data-mention-kind` so the read-only
 *     renderer can rewrite it into the correct link.
 *
 * Trigger char: `@`. The popover groups results by kind.
 */
export function createBoardMentionExtension(config: BoardMentionConfig) {
  return Mention.extend({
    /**
     * Extend the default Mention attribute set with `kind`. Tiptap
     * round-trips it through `renderHTML` so the saved DOM carries
     * `data-mention-kind="<kind>"` and `data-id="<id>"` — the
     * renderer reads both back when rewriting chips into anchors.
     */
    addAttributes() {
      return {
        ...this.parent?.(),
        kind: {
          default: "board",
          parseHTML: (element) =>
            element.getAttribute("data-mention-kind") ?? "board",
          renderHTML: (attrs) => {
            // The static `data-mention-kind="board"` from the
            // extension's HTMLAttributes provides a reasonable
            // fallback; we override per-node here.
            const kind = (attrs.kind as MentionKind) ?? "board";
            return { "data-mention-kind": kind };
          },
        },
      };
    },
  }).configure({
    HTMLAttributes: {
      class:
        "mention-board inline-flex items-center rounded bg-zinc-700/60 px-1 py-0.5 text-zinc-100",
      // Kind is overridden per-node by the attribute above; the
      // static value is just the safest fallback for legacy mentions
      // that predate the kind attr.
      "data-mention-kind": "board",
    },
    renderText({ node }) {
      const label = node.attrs.label ?? node.attrs.id ?? "";
      // Same `@<label>` shape regardless of kind. Agents prompted
      // with this text will pick up the chip via the digest we ship
      // alongside it; visually distinguishing the kind in plain
      // text would create noise (`@board:Foo` vs `@research:Bar`)
      // that the user didn't type.
      return `@${label}`;
    },
    deleteTriggerWithBackspace: true,
    suggestion: {
      char: "@",
      // Names can have spaces ("Onboarding flow"), but the popover
      // already filters live. `@on` → pick → chip is the desired
      // flow; allowing spaces would force Escape to bail out and
      // ruin freeform text.
      allowSpaces: false,
      command: ({ editor, range, props }) => {
        // Tiptap's MentionNodeAttrs doesn't know about our `kind`
        // extension attr — we widened the popover's command shape
        // ourselves. Cast through the loose suggestion-props type so
        // we can read `kind` without fighting the upstream typings.
        const attrs = props as unknown as {
          id: string;
          label?: string;
          kind?: MentionKind;
        };
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
              attrs: {
                id: attrs.id,
                label: attrs.label,
                kind: attrs.kind ?? "board",
              },
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

  const handleRef: { current: BoardMentionListHandle | null } = {
    current: null,
  };

  let latestProps = initial;
  const positionAndRender = (props: SuggestionProps<BoardMentionItem>) => {
    latestProps = props;
    const rect = props.clientRect?.();
    if (rect) {
      // The cross-mention popover is taller (3 sections + headers)
      // than the board-only one, so the height estimate is bumped a
      // bit. We still flip above when the bottom of the popover
      // would clip the viewport.
      const popoverHeightEstimate = 320;
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
      createElement(BoardMentionListWithRef, {
        ...componentProps,
        forwardedRef: (h) => {
          handleRef.current = h;
        },
      }),
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

const BoardMentionListWithRef: ComponentType<
  BoardMentionListProps & {
    forwardedRef: (h: BoardMentionListHandle | null) => void;
  }
> = ({ forwardedRef, ...rest }) =>
  createElement(BoardMentionList, { ...rest, ref: forwardedRef });

// Keep ReactRenderer in the type graph so a future refactor that
// migrates this file to use it doesn't have to re-add the import.
void ReactRenderer;
