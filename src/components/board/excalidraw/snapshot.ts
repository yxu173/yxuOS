/**
 * Snapshot shape persisted in `boards.snapshot`.
 *
 * Two design choices worth a comment:
 *
 *   1. **Versioned + engine-tagged**. `engine` and `version` are kept
 *      around even though every board renders on Excalidraw post-
 *      Phase 4. They let us evolve the persisted shape (e.g. trim
 *      `appState` further) without breaking older boards, and they
 *      make a future engine swap a one-flag-decision instead of a
 *      schema-archaeology project.
 *
 *   2. **Slim `appState`**. Excalidraw's full `AppState` is ~80 fields,
 *      most of them UI-local (which dialog is open, current eraser
 *      radius, etc.). We persist only the fields whose value should
 *      survive a reload: the background colour, theme, and the
 *      camera (scroll + zoom). Everything else gets the framework
 *      default on load.
 *
 *   3. **Files**. Excalidraw stores images in `BinaryFiles` keyed by
 *      file id. For now we round-trip the whole map so paste-an-image
 *      Just Works; once we wire Vercel Blob in we'll lift this out.
 */

import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

export type ExcalidrawSnapshotV1 = {
  engine: "excalidraw";
  version: 1;
  /**
   * The element array as Excalidraw serialises it. Stored without the
   * "deleted" entries — Excalidraw's `restore` is happy without them.
   */
  elements: readonly ExcalidrawElement[];
  /**
   * Subset of `AppState` worth persisting (camera, theme, background).
   * Everything else gets framework defaults on load.
   */
  appState?: PersistedAppState;
  /**
   * Images / embeddables pasted into the board. Keyed by file id.
   */
  files?: BinaryFiles;
};

export type PersistedAppState = Partial<
  Pick<
    AppState,
    | "viewBackgroundColor"
    | "theme"
    | "scrollX"
    | "scrollY"
    | "zoom"
    | "gridSize"
    | "gridModeEnabled"
  >
>;

/**
 * Type-guard for the persisted shape. Bails out cleanly when the
 * row contains anything that doesn't smell like a v1 Excalidraw
 * snapshot — stale rows, partially-migrated blobs, hand-edited
 * SQL. The loader mounts an empty scene in that case rather than
 * crashing.
 */
export function isExcalidrawSnapshot(
  value: unknown,
): value is ExcalidrawSnapshotV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { engine?: unknown }).engine === "excalidraw"
  );
}

/**
 * Convert a row read from Postgres into the shape Excalidraw's
 * `initialData` prop expects. Returns `null` when the row is
 * missing, empty, or has an unrecognised shape — the canvas
 * mounts empty in that case.
 */
export function toInitialData(
  raw: Record<string, unknown> | null,
): ExcalidrawInitialDataState | null {
  if (!raw) return null;
  if (!isExcalidrawSnapshot(raw)) return null;
  return {
    elements: raw.elements,
    appState: raw.appState as Partial<AppState> | undefined,
    files: raw.files,
    scrollToContent: false,
  };
}

/**
 * Build a snapshot to write back to Postgres from the live Excalidraw
 * scene. We pick only the fields worth persisting from `AppState` —
 * see the file header for rationale.
 */
export function buildSnapshot(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): ExcalidrawSnapshotV1 {
  const persisted: PersistedAppState = {
    viewBackgroundColor: appState.viewBackgroundColor,
    theme: appState.theme,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom,
    gridSize: appState.gridSize,
    gridModeEnabled: appState.gridModeEnabled,
  };
  return {
    engine: "excalidraw",
    version: 1,
    elements,
    appState: persisted,
    files,
  };
}
