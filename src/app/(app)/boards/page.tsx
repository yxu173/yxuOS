import { eq } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { WorkspaceGrid } from "@/components/workspaces/workspace-grid";
import { WorkspaceTabs } from "@/components/workspaces/workspace-tabs";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { listUserTeams } from "@/lib/teams";

import { createBoard, deleteBoard, renameBoard } from "./actions";

export default async function BoardsIndexPage() {
  const { session, teamId } = await requireActiveTeam();

  const [userBoards, teams] = await Promise.all([
    db.query.boards.findMany({
      where: eq(boards.teamId, teamId),
      columns: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    listUserTeams(session.user.id),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
        <WorkspaceTabs active="boards" />

        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
            <p className="text-sm text-muted-foreground">
              Whiteboards owned by this team.
            </p>
          </div>
          <form action={createBoard}>
            <Button type="submit">New board</Button>
          </form>
        </header>

        <WorkspaceGrid
          items={userBoards}
          hrefBase="/boards"
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
