"use client";

/**
 * Subtle "Search ⌘K" pill for the top bar.
 *
 * Functions purely as a discoverability hint for the global launcher
 * mounted in `(app)/layout.tsx`. Clicking it dispatches a synthetic
 * ⌘K so the launcher's existing keyboard listener picks it up — no
 * separate state plumbing needed.
 *
 * Lives in its own client file because the surrounding `AppTopBar`
 * is a server component and React's RSC boundary disallows passing
 * an `onClick` directly to a client primitive from server JSX.
 */
export function QuickSearchHint() {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
          }),
        );
      }}
      title="Quick search (⌘K)"
      aria-label="Quick search"
      className="hidden items-center gap-1.5 rounded border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-white/20 hover:text-zinc-300 sm:inline-flex"
    >
      <span>Search</span>
      <kbd className="rounded border border-white/10 bg-white/5 px-1 text-[10px] tabular-nums text-zinc-400">
        ⌘K
      </kbd>
    </button>
  );
}
