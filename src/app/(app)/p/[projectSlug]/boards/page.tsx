import { and, eq } from "drizzle-orm";

import { createBoard } from "@/app/(app)/boards/actions";
import { listBoardFoldersForProject } from "@/app/(app)/boards/folder-actions";
import { BoardFolderTree } from "@/components/board-folders/folder-tree";
import {
  buildFolderTree,
  type FolderTreeBoard,
} from "@/components/board-folders/types";
import { Button } from "@/components/ui/button";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";

interface PageProps {
  params: Promise<{ projectSlug: string }>;
}

export default async function ProjectBoardsIndexPage({ params }: PageProps) {
  const { projectSlug } = await params;

  const { session, teamId, projectId, projectName } =
    await requireActiveProject(projectSlug);

  const [boardRows, teams, projects, folderRows] = await Promise.all([
    db.query.boards.findMany({
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
    }),
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
    listBoardFoldersForProject(projectId),
  ]);

  const boardEntries: Array<FolderTreeBoard & { folderId: string | null }> =
    boardRows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
      folderId: row.folderId,
      creator: row.owner
        ? {
            name: row.owner.name,
            username: row.owner.displayUsername ?? row.owner.username,
          }
        : null,
    }));

  const { roots, rootBoards } = buildFolderTree({
    folders: folderRows,
    boards: boardEntries,
  });

  // Flatten the folder tree into a depth-annotated list for the
  // per-board "Move to…" submenu.
  const flatFolders: Array<{ id: string; name: string; depth: number }> = [];
  const walk = (nodes: typeof roots, depth: number) => {
    for (const node of nodes) {
      flatFolders.push({ id: node.id, name: node.name, depth });
      if (node.children.length > 0) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);

  const createInProject = createBoard.bind(null, projectSlug);

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
        active="boards"
        projectSlug={projectSlug}
        projects={projects}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
            <p className="text-sm text-muted-foreground">
              Whiteboards in <span className="text-zinc-200">{projectName}</span>.
              Organise them into folders to keep work-streams tidy.
            </p>
          </div>
          <form action={createInProject}>
            <Button type="submit">New board</Button>
          </form>
        </header>

        <BoardFolderTree
          roots={roots}
          rootBoards={rootBoards}
          hrefBase={`/p/${projectSlug}/boards`}
          projectSlug={projectSlug}
          allFolders={flatFolders}
        />
      </main>
    </div>
  );
}
