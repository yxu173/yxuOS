"use client";

import { memo } from "react";

import type { RemoteCursor } from "./use-multiplayer-cursors";

export interface MultiplayerCursorsProps {
  cursors: RemoteCursor[];
}

/**
 * Renders coloured cursor labels for other users currently on the board.
 * Each label is positioned via absolute coordinates scaled by the current
 * canvas zoom level.
 */
export const MultiplayerCursors = memo(function MultiplayerCursors({
  cursors,
}: MultiplayerCursorsProps) {
  if (cursors.length === 0) return null;

  return (
    <>
      {cursors.map((c) => (
        <div
          key={c.userId}
          className="pointer-events-none absolute z-40 select-none"
          style={{
            left: c.x,
            top: c.y,
            transform: `scale(${1 / c.canvasZoom})`,
            transformOrigin: "top left",
          }}
        >
          {/* Arrow cursor icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            className="drop-shadow-sm"
          >
            <path
              d="M1.5 1.5L5.5 13L7.5 7.5L13 5.5L1.5 1.5Z"
              fill={c.color}
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="0.5"
            />
          </svg>
          {/* Name label */}
          <div
            className="ml-3.5 -mt-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white shadow-sm"
            style={{ backgroundColor: c.color, maxWidth: 120 }}
          >
            {c.name}
          </div>
        </div>
      ))}
    </>
  );
});
