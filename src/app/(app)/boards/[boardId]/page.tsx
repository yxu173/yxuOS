import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

/**
 * Legacy redirect — looks up the board's project and forwards to
 * `/p/<projectSlug>/boards/<boardId>`. Falls back to the team's default
 * project if the board predates the projects rollout (the backfill
 * stamps every row, so this fallback only kicks in if a row was
 * created without project_id between commits).
 */
export default async function LegacyBoardDetailRedirect({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const { teamId } = await requireActiveTeam();

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.teamId, teamId)),
    columns: { id: true },
    with: {
      project: { columns: { slug: true } },
    },
  });
  if (!board) notFound();

  const slug = board.project?.slug ?? (await ensureDefaultProject(teamId)).slug;
  redirect(`/p/${slug}/boards/${board.id}`);
}
