"use client";

import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { useState } from "react";

import { createBoardFolder } from "@/app/(app)/boards/folder-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BoardCardInFolder, type FolderOption } from "./board-card";
import { CreateFolderDialog, FolderActionsMenu } from "./folder-actions-menu";
import type { FolderTreeNode } from "./types";

export interface BoardFolderTreeProps {
  /** Top-level folders. Children render recursively. */
  roots: FolderTreeNode[];
  /** Boards that aren't filed in any folder. Render at the project root level. */
  rootBoards: FolderTreeNode["boards"];
  /** Used by board cards to build their detail-page URL. */
  hrefBase: string;
  /** Project slug — passed to `createBoardFolder` from "+ New folder" buttons. */
  projectSlug: string;
  /** Flat list of every folder in the project — fed into the per-board "Move to…" submenu. */
  allFolders: FolderOption[];
}

/**
 * Recursive folder + board tree for the boards index. Top-level renders
 * a small ribbon with "New folder" + the root-level "ungrouped" boards
 * above the named folder list.
 */
export function BoardFolderTree({
  roots,
  rootBoards,
  hrefBase,
  projectSlug,
  allFolders,
}: BoardFolderTreeProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Folders
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5"
        >
          <FolderPlus className="size-3.5" />
          New folder
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        {rootBoards.length > 0 ? (
          <section className="flex flex-col gap-0.5 rounded-md border border-dashed border-white/10 bg-white/[0.015] p-2">
            <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-500">
              Not filed
            </p>
            <ul className="flex flex-col gap-0.5">
              {rootBoards.map((board) => (
                <li key={board.id}>
                  <BoardCardInFolder
                    board={board}
                    currentFolderId={null}
                    hrefBase={hrefBase}
                    allFolders={allFolders}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {roots.length === 0 && rootBoards.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/10 bg-white/[0.015] p-6 text-center text-sm text-muted-foreground">
            No folders yet. Create one to organise boards.
          </p>
        ) : null}

        {roots.map((node) => (
          <FolderNode
            key={node.id}
            node={node}
            depth={0}
            hrefBase={hrefBase}
            projectSlug={projectSlug}
            allFolders={allFolders}
          />
        ))}
      </div>

      <CreateFolderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        parentFolderId={null}
        parentFolderName={null}
        onSubmit={async (name) => {
          await createBoardFolder({
            projectSlug,
            name,
            parentFolderId: null,
          });
        }}
      />
    </div>
  );
}

interface FolderNodeProps {
  node: FolderTreeNode;
  depth: number;
  hrefBase: string;
  projectSlug: string;
  allFolders: FolderOption[];
}

function FolderNode({
  node,
  depth,
  hrefBase,
  projectSlug,
  allFolders,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [createChildOpen, setCreateChildOpen] = useState(false);
  const Indicator = expanded ? ChevronDown : ChevronRight;
  const totalBoards = countBoards(node);

  return (
    <section
      className="rounded-md border border-white/5 bg-white/[0.015]"
      style={{ marginLeft: depth * 12 }}
    >
      <header className="group/folder flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex flex-1 items-center gap-1.5 text-left text-sm text-zinc-200"
          aria-expanded={expanded}
        >
          <Indicator className="size-3.5 text-zinc-500" />
          <Folder
            className="size-3.5 shrink-0"
            style={{ color: node.color ?? "rgb(161 161 170)" }}
          />
          <span className="truncate font-medium">{node.name}</span>
          <span className="text-[10px] tabular-nums text-zinc-500">
            {totalBoards}
          </span>
        </button>
        <FolderActionsMenu
          folderId={node.id}
          folderName={node.name}
          onCreateChild={() => setCreateChildOpen(true)}
        />
      </header>

      {expanded ? (
        <div
          className={cn(
            "flex flex-col gap-1 px-1 pb-2",
            depth > 0 && "border-t border-white/5",
          )}
        >
          {node.boards.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {node.boards.map((board) => (
                <li key={board.id}>
                  <BoardCardInFolder
                    board={board}
                    currentFolderId={node.id}
                    hrefBase={hrefBase}
                    allFolders={allFolders}
                  />
                </li>
              ))}
            </ul>
          ) : node.children.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Empty folder.
            </p>
          ) : null}

          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              hrefBase={hrefBase}
              projectSlug={projectSlug}
              allFolders={allFolders}
            />
          ))}
        </div>
      ) : null}

      <CreateFolderDialog
        open={createChildOpen}
        onOpenChange={setCreateChildOpen}
        parentFolderId={node.id}
        parentFolderName={node.name}
        onSubmit={async (name) => {
          await createBoardFolder({
            projectSlug,
            name,
            parentFolderId: node.id,
          });
        }}
      />
    </section>
  );
}

function countBoards(node: FolderTreeNode): number {
  let total = node.boards.length;
  for (const child of node.children) total += countBoards(child);
  return total;
}
