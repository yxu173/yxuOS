"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CURSOR_COLORS = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#e879f9",
];

const PUSH_MS = 200;
const POLL_MS = 500;

export interface RemoteCursor {
  userId: string;
  name: string;
  x: number;
  y: number;
  canvasZoom: number;
  color: string;
}

function pickColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

/**
 * Hook for multiplayer cursor presence. Tracks the local user's mouse
 * position on the Excalidraw canvas and shares it via a Redis-backed
 * polling API. Returns a list of remote cursors to render as an overlay.
 */
export function useMultiplayerCursors(
  boardId: string,
  userId: string,
  userName: string,
  canvasEl: HTMLElement | null,
  canvasZoom: number,
) {
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const localRef = useRef({ x: 0, y: 0 });
  const color = pickColor(userId);

  // Track mouse position on the canvas
  useEffect(() => {
    if (!canvasEl) return;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      localRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    canvasEl.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => canvasEl.removeEventListener("mousemove", handleMouseMove);
  }, [canvasEl]);

  // Push local cursor position
  useEffect(() => {
    if (!canvasEl) return;
    const interval = setInterval(async () => {
      const { x, y } = localRef.current;
      try {
        await fetch(`/api/boards/${boardId}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            x,
            y,
            canvasZoom,
            name: userName,
            color,
          }),
        });
      } catch {
        // silently ignore
      }
    }, PUSH_MS);
    return () => clearInterval(interval);
  }, [boardId, userId, userName, canvasZoom, canvasEl, color]);

  // Poll for remote cursors
  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/boards/${boardId}/presence?userId=${encodeURIComponent(userId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setCursors((data.cursors ?? []) as RemoteCursor[]);
    } catch {
      // silently ignore
    }
  }, [boardId, userId]);

  useEffect(() => {
    const id = setInterval(poll, POLL_MS);
    // Defer the initial fetch to avoid synchronous setState in effect.
    const timeout = setTimeout(() => void poll(), 0);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [poll]);

  return { cursors };
}
