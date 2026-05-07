import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

export default async function LegacyTaskDetailRedirect({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const { teamId } = await requireActiveTeam();

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.teamId, teamId)),
    columns: { id: true },
    with: {
      project: { columns: { slug: true } },
    },
  });
  if (!task) notFound();

  const slug = task.project?.slug ?? (await ensureDefaultProject(teamId)).slug;
  redirect(`/p/${slug}/tasks/${task.id}`);
}
