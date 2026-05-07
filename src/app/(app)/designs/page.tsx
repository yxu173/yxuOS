import { redirect } from "next/navigation";

import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

export default async function LegacyDesignsRedirect() {
  const { teamId } = await requireActiveTeam();
  const project = await ensureDefaultProject(teamId);
  redirect(`/p/${project.slug}/designs`);
}
