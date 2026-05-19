/**
 * Cached read helpers for the boards listing surfaces (sidebar, index
 * page, home dashboard). All callers used to inline the same Drizzle
 * `findMany` — sharing them through here unlocks one Redis-backed cache
 * per shape and gives us a single place to bust on writes.
 *
 * What we cache:
 *  - Per-project board list (the left-side sibling list on every board page)
 *  - Per-project folder list (the folder tree skeleton)
 *
 * What we do NOT cache:
 *  - `board.snapshot` — mutated on every keystroke during edits, far too
 *    hot to write through Redis. Reads go straight to Postgres.
 *  - Board metadata for a single board (id, name, threadId, …) — already
 *    fetched alongside the snapshot in the same query, so caching it
 *    separately would either duplicate the round-trip or require splitting
 *    the page query for negligible gain.
 *
 * Invalidation: every write path that mutates a board's project/folder/
 * name/owner calls `bustProjectBoards(projectId)`, which busts the tag
 * shared by both helpers.
 */

import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { boardFolders, boards } from "@/db/schema";

import { cached, cacheKey, invalidateTag } from "../cache";

/** Tag shared by every cache entry derived from a project's boards / folders. */
export const projectBoardsTag = (projectId: string) =>
  `project:${projectId}:boards`;

export interface ProjectBoardListItem {
  id: string;
  name: string;
  updatedAt: Date;
}

/**
 * Lightweight sibling-boards list used by the board editor's left
 * sidebar. 60 s TTL — busted on board create / rename / delete /
 * folder-move so the user sees their changes immediately.
 */
export async function listBoardsForProject(
  teamId: string,
  projectId: string,
): Promise<ProjectBoardListItem[]> {
  return cached(
    cacheKey("project-boards", teamId, projectId),
    { ttl: 60, tags: [projectBoardsTag(projectId)] },
    async () =>
      db.query.boards.findMany({
        where: and(
          eq(boards.teamId, teamId),
          eq(boards.projectId, projectId),
        ),
        orderBy: desc(boards.updatedAt),
        columns: {
          id: true,
          name: true,
          updatedAt: true,
        },
      }),
  );
}

export interface ProjectBoardListItemWithMeta {
  id: string;
  name: string;
  folderId: string | null;
  updatedAt: Date;
  creator: {
    name: string;
    username: string | null;
  } | null;
}

/**
 * Richer per-project board list with owner + folder, used by the
 * `/p/[slug]/boards` index page. Same tag as the lightweight list so a
 * single invalidation busts both shapes.
 */
export async function listBoardsForProjectIndex(
  teamId: string,
  projectId: string,
): Promise<ProjectBoardListItemWithMeta[]> {
  return cached(
    cacheKey("project-boards-index", teamId, projectId),
    { ttl: 60, tags: [projectBoardsTag(projectId)] },
    async () => {
      const rows = await db.query.boards.findMany({
        where: and(
          eq(boards.teamId, teamId),
          eq(boards.projectId, projectId),
        ),
        columns: {
          id: true,
          name: true,
          folderId: true,
          updatedAt: true,
        },
        with: {
          owner: {
            columns: {
              name: true,
              username: true,
              displayUsername: true,
            },
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        folderId: row.folderId,
        updatedAt: row.updatedAt,
        creator: row.owner
          ? {
              name: row.owner.name,
              username: row.owner.displayUsername ?? row.owner.username,
            }
          : null,
      }));
    },
  );
}

export interface BoardFolderRow {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  sortOrder: number;
  createdAt: Date;
}

/**
 * Folder tree skeleton for the boards sidebar / index page. Same
 * invalidation tag as the board lists — folder writes always touch
 * the boards rendering and vice versa, so coupling them is correct.
 */
export async function listBoardFoldersForProjectCached(
  projectId: string,
): Promise<BoardFolderRow[]> {
  return cached(
    cacheKey("project-board-folders", projectId),
    { ttl: 60, tags: [projectBoardsTag(projectId)] },
    async () =>
      db.query.boardFolders.findMany({
        where: eq(boardFolders.projectId, projectId),
        orderBy: [asc(boardFolders.sortOrder), asc(boardFolders.name)],
        columns: {
          id: true,
          name: true,
          color: true,
          parentFolderId: true,
          sortOrder: true,
          createdAt: true,
        },
      }),
  );
}

/**
 * Invalidate every cached listing for a project. Call from every write
 * path that mutates a board or board-folder row in that project. Cheap
 * — a tag bust is ~one Redis round-trip regardless of how many keys
 * are tagged.
 */
export async function bustProjectBoards(projectId: string): Promise<void> {
  await invalidateTag(projectBoardsTag(projectId));
}
