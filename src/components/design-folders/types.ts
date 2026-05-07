export interface DesignFolderTreeItem {
  id: string;
  name: string;
  updatedAt: Date;
  creator: { name: string; username: string | null } | null;
}

export interface DesignFolderTreeNode {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  children: DesignFolderTreeNode[];
  designs: DesignFolderTreeItem[];
}

export function buildDesignFolderTree(input: {
  folders: Array<{
    id: string;
    name: string;
    color: string | null;
    parentFolderId: string | null;
  }>;
  designs: Array<DesignFolderTreeItem & { folderId: string | null }>;
}): {
  roots: DesignFolderTreeNode[];
  rootDesigns: DesignFolderTreeItem[];
} {
  const nodeById = new Map<string, DesignFolderTreeNode>();
  for (const folder of input.folders) {
    nodeById.set(folder.id, {
      id: folder.id,
      name: folder.name,
      color: folder.color,
      parentFolderId: folder.parentFolderId,
      children: [],
      designs: [],
    });
  }

  const roots: DesignFolderTreeNode[] = [];
  for (const node of nodeById.values()) {
    if (node.parentFolderId && nodeById.has(node.parentFolderId)) {
      nodeById.get(node.parentFolderId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const rootDesigns: DesignFolderTreeItem[] = [];
  for (const design of input.designs) {
    if (design.folderId && nodeById.has(design.folderId)) {
      nodeById.get(design.folderId)!.designs.push({
        id: design.id,
        name: design.name,
        updatedAt: design.updatedAt,
        creator: design.creator,
      });
    } else {
      rootDesigns.push({
        id: design.id,
        name: design.name,
        updatedAt: design.updatedAt,
        creator: design.creator,
      });
    }
  }

  return { roots, rootDesigns };
}
