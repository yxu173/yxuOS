import { and, eq } from "drizzle-orm";

import {
  createBoard,
  deleteBoard,
  renameBoard,
} from "@/app/(app)/boards/actions";
import { Button } from "@/components/ui/button";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { WorkspaceGrid } from "@/components/workspaces/workspace-grid";
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

  const [boardRows, teams, projects] = await Promise.all([
    db.query.boards.findMany({
      where: and(
        eq(boards.teamId, teamId),
        eq(boards.projectId, projectId),
      ),
      columns: {
        id: true,
        name: true,
        createdAt: true,
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
  ]);

  const userBoards = boardRows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    creator: row.owner
      ? {
          name: row.owner.name,
          username: row.owner.displayUsername ?? row.owner.username,
        }
      : null,
  }));

  // Bind the slug at the call site so the form action lands the new
  // board in the right project.
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
            </p>
          </div>
          <form action={createInProject}>
            <Button type="submit">New board</Button>
          </form>
        </header>

        <WorkspaceGrid
          items={userBoards}
          hrefBase={`/p/${projectSlug}/boards`}
          itemLabel="board"
          itemLabelPlural="boards"
          emptyHint='Hit "New board" to start whiteboarding.'
          renameAction={renameBoard}
          deleteAction={deleteBoard}
        />
      </main>
    </div>
  );
}
