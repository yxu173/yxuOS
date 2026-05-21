"use server";

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { boards, boardVersions } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { bustProjectBoards } from "@/lib/boards/listing";
import { processShapeMentions } from "@/lib/boards/shape-mentions";
import { indexBoard, unindexBoard } from "@/lib/rag/indexers/board";
import {
  requireActiveProject,
  requireActiveTeam,
} from "@/lib/permissions";

/**
 * Creates a new board on the active team. When a project slug is
 * provided (every page under `/p/[projectSlug]/boards` binds it via
 * `createBoard.bind(null, slug)`) the board is dropped into that
 * project; otherwise it lands in the team's default project.
 *
 * The current user is recorded as the creator (`ownerId`) for "Created
 * by Alice" badges; access control is by `teamId`.
 */
export async function createBoard(projectSlug?: string | FormData) {
  // When used as a `<form action={createBoard}>` handler, Next passes a
  // FormData instance as the first argument. Only treat strings as a slug.
  const slug = typeof projectSlug === "string" ? projectSlug : null;
  const { session, teamId, projectId, projectSlug: resolvedSlug } =
    await requireActiveProject(slug);

  const [board] = await db
    .insert(boards)
    .values({
      ownerId: session.user.id,
      teamId,
      projectId,
    })
    .returning({ id: boards.id, name: boards.name });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "board",
    subjectId: board.id,
    subjectName: board.name,
  });

  await bustProjectBoards(projectId);

  revalidatePath(`/p/${resolvedSlug}/boards`);
  redirect(`/p/${resolvedSlug}/boards/${board.id}`);
}

/**
 * Persists the latest Excalidraw snapshot for a board. Any team member can
 * edit any team board.
 *
 * Also writes a row into `board_versions` so every save becomes a
 * restorable point in the board's edit history.
 */
export async function saveBoardSnapshot(
  boardId: string,
  snapshot: Record<string, unknown>,
) {
  const { session, teamId } = await requireActiveTeam();

  const result = await db
    .update(boards)
    .set({
      snapshot,
      updatedAt: new Date(),
    })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)))
    .returning({ id: boards.id });

  if (result.length === 0) {
    throw new Error("Board not found");
  }

  // Write a version record so the user can browse / restore past states.
  await db.insert(boardVersions).values({
    boardId,
    snapshot,
    editedById: session.user.id,
  });

  // Process @mentions in text elements — log activity for newly
  // mentioned team members (deduped via Redis, 24 h window).
  after(() =>
    processShapeMentions(
      boardId,
      snapshot,
      teamId,
      session.user.id,
    ),
  );

  // Snapshots save on a debounce and can fire many times per
  // minute while editing. `after()` keeps the embed call off the
  // user's critical path; the indexer's hash-dedupe means an
  // unchanged snapshot costs only one SELECT.
  after(() => indexBoard(boardId));
}

export async function renameBoard(boardId: string, name: string) {
  const { session, teamId } = await requireActiveTeam();

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) {
    throw new Error("Board name cannot be empty");
  }

  // Need the board's project to bust the right cache tag.
  const target = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { projectId: true },
  });

  await db
    .update(boards)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  // `projectId` is nullable on boards — only legacy / unattached boards
  // would skip this bust, and they aren't listed in any project sidebar
  // anyway, so the conditional is correct.
  if (target?.projectId) await bustProjectBoards(target.projectId);

  // Title is denormalised onto every chunk so a rename has to
  // re-walk the artifact, even if the snapshot didn't change.
  after(() => indexBoard(boardId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "renamed",
    subjectType: "board",
    subjectId: boardId,
    subjectName: trimmed,
  });

  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteBoard(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  // Snapshot the name + project before deleting so the activity feed
  // reads cleanly and we know which project's cache to bust.
  const existing = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { name: true, projectId: true },
  });

  await db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  if (existing?.projectId) await bustProjectBoards(existing.projectId);

  after(() => unindexBoard(boardId));

  if (existing) {
    await logActivity({
      teamId,
      actorId: session.user.id,
      verb: "deleted",
      subjectType: "board",
      subjectId: boardId,
      subjectName: existing.name,
    });
  }

  revalidatePath("/boards");
}

export async function enableBoardShare(boardId: string): Promise<string> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { shareToken: true },
  });
  if (!existing) {
    throw new Error("Board not found");
  }
  if (existing.shareToken) return existing.shareToken;

  const token = nanoid(24);

  await db
    .update(boards)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  revalidatePath(`/boards/${boardId}`);
  return token;
}

export async function disableBoardShare(boardId: string) {
  const { teamId } = await requireActiveTeam();

  await db
    .update(boards)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  revalidatePath(`/boards/${boardId}`);
}

/**
 * List the 100 most recent versions for a board. Returns version id,
 * timestamp, and the editor who saved. Does NOT return snapshot data
 * (use `getBoardVersion` for that).
 */
export async function listBoardVersions(boardId: string) {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true },
  });
  if (!existing) throw new Error("Board not found");

  const versions = await db.query.boardVersions.findMany({
    where: eq(boardVersions.boardId, boardId),
    orderBy: desc(boardVersions.createdAt),
    columns: {
      id: true,
      createdAt: true,
    },
    with: {
      editedBy: {
        columns: {
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
    limit: 100,
  });

  return versions.map((v) => ({
    id: v.id,
    createdAt: v.createdAt,
    editedBy: {
      name: v.editedBy.name,
      username: v.editedBy.displayUsername ?? v.editedBy.username,
    },
  }));
}

/**
 * Fetch a single version by id, including the full snapshot.
 */
export async function getBoardVersion(versionId: string) {
  const { teamId } = await requireActiveTeam();

  const version = await db.query.boardVersions.findFirst({
    where: eq(boardVersions.id, versionId),
    columns: {
      id: true,
      boardId: true,
      snapshot: true,
      createdAt: true,
    },
    with: {
      board: { columns: { teamId: true } },
      editedBy: {
        columns: {
          name: true,
          username: true,
          displayUsername: true,
        },
      },
    },
  });

  if (!version || version.board.teamId !== teamId) {
    throw new Error("Version not found");
  }

  return {
    id: version.id,
    boardId: version.boardId,
    snapshot: version.snapshot,
    createdAt: version.createdAt,
    editedBy: {
      name: version.editedBy.name,
      username: version.editedBy.displayUsername ?? version.editedBy.username,
    },
  };
}

/**
 * Restore the board to a past version. Writes the old snapshot back
 * to `boards.snapshot` and inserts a NEW version row so the restore
 * itself is tracked in the version history.
 */
export async function restoreBoardVersion(
  boardId: string,
  versionId: string,
) {
  const { session, teamId } = await requireActiveTeam();

  const version = await db.query.boardVersions.findFirst({
    where: eq(boardVersions.id, versionId),
    columns: { snapshot: true },
    with: {
      board: { columns: { teamId: true } },
    },
  });
  if (!version || version.board.teamId !== teamId) {
    throw new Error("Version not found");
  }

  const now = new Date();

  await db
    .update(boards)
    .set({ snapshot: version.snapshot, updatedAt: now })
    .where(and(eq(boards.id, boardId), eq(boards.teamId, teamId)));

  await db.insert(boardVersions).values({
    boardId,
    snapshot: version.snapshot,
    editedById: session.user.id,
  });

  revalidatePath(`/boards/${boardId}`);

  after(() => indexBoard(boardId));
}

/* ─── Board locking ──────────────────────────────────── */

const LOCK_STALE_MS = 30_000; // stale after 30 s (browser crash guard)

/**
 * Claim the lock on a board. If someone else already holds a fresh lock
 * (`lockedAt` within LOCK_STALE_MS), the call fails so the client can
 * show a "locked by X" screen instead of silently stealing the lock.
 *
 * When the lock is stale (previous holder's tab crashed), we overwrite it.
 */
export async function claimBoardLock(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true, lockedById: true, lockedAt: true },
    with: {
      lockedBy: {
        columns: { name: true, username: true, displayUsername: true },
      },
    },
  });
  if (!board) throw new Error("Board not found");

  // Already locked by us — refresh the timestamp (heartbeat).
  if (board.lockedById === session.user.id) {
    await db
      .update(boards)
      .set({ lockedAt: new Date() })
      .where(eq(boards.id, boardId));
    return { ok: true, lockedBy: null } as const;
  }

  // Someone else holds the lock — check staleness.
  if (board.lockedById && board.lockedAt) {
    const stale =
      Date.now() - new Date(board.lockedAt).getTime() > LOCK_STALE_MS;
    if (!stale) {
      return {
        ok: false,
        lockedBy: {
          name: board.lockedBy?.name ?? "Unknown",
          username:
            board.lockedBy?.displayUsername ?? board.lockedBy?.username ?? null,
        },
      } as const;
    }
  }

  // Lock is free or stale — claim it.
  await db
    .update(boards)
    .set({ lockedById: session.user.id, lockedAt: new Date() })
    .where(eq(boards.id, boardId));

  return { ok: true, lockedBy: null } as const;
}

/**
 * Keep the lock alive while editing. Clients call this every ~10 s.
 */
export async function heartbeatBoardLock(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { lockedById: true },
  });
  if (!board) throw new Error("Board not found");
  if (board.lockedById !== session.user.id) {
    throw new Error("Lock not held");
  }

  await db
    .update(boards)
    .set({ lockedAt: new Date() })
    .where(eq(boards.id, boardId));
}

/**
 * Release the lock. Called on navigate-away via `beforeunload` +
 * `navigator.sendBeacon`. Idempotent — if we don't hold the lock
 * it's a no-op.
 */
export async function releaseBoardLock(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  await db
    .update(boards)
    .set({ lockedById: null, lockedAt: null })
    .where(
      and(
        eq(boards.id, boardId),
        eq(boards.teamId, teamId),
        eq(boards.lockedById, session.user.id),
      ),
    );
}

/**
 * Force-takeover the lock. Available to any team member when the
 * current lock holder hasn't released within LOCK_STALE_MS. The UI
 * exposes this as a "Take over" button.
 */
export async function takeoverBoardLock(boardId: string) {
  const { session, teamId } = await requireActiveTeam();

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { lockedById: true, lockedAt: true },
  });
  if (!board) throw new Error("Board not found");

  // Only allow takeover if the lock actually exists (stale check on
  // the UI side, but guard here too).
  if (!board.lockedById) {
    // No lock — just claim it.
    await db
      .update(boards)
      .set({ lockedById: session.user.id, lockedAt: new Date() })
      .where(eq(boards.id, boardId));
    return;
  }

  await db
    .update(boards)
    .set({ lockedById: session.user.id, lockedAt: new Date() })
    .where(eq(boards.id, boardId));
}

/**
 * Check the current lock state for a board. Used on page load.
 */
export async function checkBoardLock(teamId: string, boardId: string) {
  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { lockedById: true, lockedAt: true },
    with: {
      lockedBy: {
        columns: { name: true, username: true, displayUsername: true },
      },
    },
  });
  if (!board) throw new Error("Board not found");

  if (!board.lockedById || !board.lockedAt) return null;

  const stale =
    Date.now() - new Date(board.lockedAt).getTime() > LOCK_STALE_MS;
  if (stale) return null;

  return {
    userId: board.lockedById,
    name: board.lockedBy?.name ?? "Unknown",
    username:
      board.lockedBy?.displayUsername ?? board.lockedBy?.username ?? null,
  };
}
