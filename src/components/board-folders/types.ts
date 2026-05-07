export interface FolderTreeBoard {
  id: string;
  name: string;
  updatedAt: Date;
  creator: { name: string; username: string | null } | null;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  children: FolderTreeNode[];
  boards: FolderTreeBoard[];
}

/**
 * Builds the nested tree representation that the UI renders. Folders
 * with `parent_folder_id = null` become roots; every other folder is
 * attached to its parent.
 *
 * Boards with `folder_id = null` are returned separately as
 * `rootBoards` so the page renders them above the named folders ("not
 * filed" bucket).
 */
export function buildFolderTree(input: {
  folders: Array<{
    id: string;
    name: string;
    color: string | null;
    parentFolderId: string | null;
  }>;
  boards: Array<FolderTreeBoard & { folderId: string | null }>;
}): { roots: FolderTreeNode[]; rootBoards: FolderTreeBoard[] } {
  const nodeById = new Map<string, FolderTreeNode>();
  for (const folder of input.folders) {
    nodeById.set(folder.id, {
      id: folder.id,
      name: folder.name,
      color: folder.color,
      parentFolderId: folder.parentFolderId,
      children: [],
      boards: [],
    });
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodeById.values()) {
    if (node.parentFolderId && nodeById.has(node.parentFolderId)) {
      nodeById.get(node.parentFolderId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const rootBoards: FolderTreeBoard[] = [];
  for (const board of input.boards) {
    if (board.folderId && nodeById.has(board.folderId)) {
      nodeById.get(board.folderId)!.boards.push({
        id: board.id,
        name: board.name,
        updatedAt: board.updatedAt,
        creator: board.creator,
      });
    } else {
      rootBoards.push({
        id: board.id,
        name: board.name,
        updatedAt: board.updatedAt,
        creator: board.creator,
      });
    }
  }

  return { roots, rootBoards };
}
