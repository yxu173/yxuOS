import type { NextRequest } from "next/server";

import { getRedis } from "@/lib/cache/redis";

const PRESENCE_TTL = 15;

interface CursorState {
  x: number;
  y: number;
  canvasZoom: number;
  name: string;
  color: string;
}

/**
 * GET /api/boards/[boardId]/presence
 *
 * Returns cursor positions of all active users on this board.
 *
 * No auth — cursor data is cosmetic, expires in 15 s, and Redis keys
 * are boardId-scoped. A malicious caller can at most fill Redis with
 * short-lived junk.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const redis = getRedis();
  if (!redis) return Response.json({ cursors: [] });

  const prefix = `presence:board:${boardId}:user:`;
  const keys = await redis.keys(`${prefix}*`);

  if (keys.length === 0) return Response.json({ cursors: [] });

  const rawValues = (await redis.mget(...keys)) as (CursorState | null)[] | null;
  const excludeUserId = req.nextUrl.searchParams.get("userId");

  const cursors: (CursorState & { userId: string })[] = [];
  if (rawValues) {
    for (let i = 0; i < keys.length; i++) {
      const v = rawValues[i];
      if (!v) continue;
      const userId = keys[i].slice(prefix.length);
      if (userId === excludeUserId) continue;
      cursors.push({ userId, ...v });
    }
  }

  return Response.json({ cursors });
}

/**
 * POST /api/boards/[boardId]/presence
 *
 * Writes the caller's cursor to Redis. No auth — same rationale as GET.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });

  const body = (await req.json()) as {
    userId: string;
    x: number;
    y: number;
    canvasZoom: number;
    name: string;
    color: string;
  };

  await redis.set(
    `presence:board:${boardId}:user:${body.userId}`,
    {
      x: body.x,
      y: body.y,
      canvasZoom: body.canvasZoom,
      name: body.name,
      color: body.color,
    } satisfies CursorState,
    { ex: PRESENCE_TTL },
  );

  return Response.json({ ok: true });
}
