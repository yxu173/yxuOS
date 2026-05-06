"use client";

import { useDesignCanvas } from "./canvas-store";

const HANDLE_SIZE = 12; // world-space pixels (scaled with the camera)

/**
 * Draws selection chrome on top of selected artboards.
 *
 * Lives inside the transformed world so the borders / handles scale
 * naturally with the camera. The blue border itself is drawn via box-shadow
 * on the artboard frame in ArtboardView; this overlay handles only the
 * resize handles for now (decorative — wiring them up to actually resize
 * lives in a later commit).
 */
export function SelectionOverlay() {
  const selection = useDesignCanvas((state) => state.selection);
  const artboards = useDesignCanvas((state) => state.artboards);

  if (selection.length === 0) return null;

  return (
    <>
      {selection.map((id) => {
        const artboard = artboards.find((a) => a.id === id);
        if (!artboard) return null;
        return (
          <div
            key={id}
            className="pointer-events-none absolute"
            style={{
              left: artboard.x - HANDLE_SIZE / 2,
              top: artboard.y - HANDLE_SIZE / 2,
              width: artboard.w + HANDLE_SIZE,
              height: artboard.h + HANDLE_SIZE,
            }}
          >
            {/* Corner + edge handles, decorative */}
            {(
              [
                ["nw", 0, 0],
                ["ne", artboard.w, 0],
                ["sw", 0, artboard.h],
                ["se", artboard.w, artboard.h],
              ] as const
            ).map(([key, x, y]) => (
              <span
                key={key}
                className="absolute rounded-full bg-blue-500"
                style={{
                  left: x,
                  top: y,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  border: "2px solid white",
                }}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
