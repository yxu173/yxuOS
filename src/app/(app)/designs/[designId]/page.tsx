import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { designs } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

export default async function LegacyDesignDetailRedirect({
  params,
}: {
  params: Promise<{ designId: string }>;
}) {
  const { designId } = await params;
  const { teamId } = await requireActiveTeam();

  const design = await db.query.designs.findFirst({
    where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
    columns: { id: true },
    with: {
      project: { columns: { slug: true } },
    },
  });
  if (!design) notFound();

  const slug =
    design.project?.slug ?? (await ensureDefaultProject(teamId)).slug;
  redirect(`/p/${slug}/designs/${design.id}`);
}
