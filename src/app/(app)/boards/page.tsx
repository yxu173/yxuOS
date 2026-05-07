import { redirect } from "next/navigation";

import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

/**
 * Legacy redirect — the canonical boards index lives under
 * `/p/<projectSlug>/boards` after the projects rollout. Anything still
 * pointing at `/boards` lands on the active team's default project.
 */
export default async function LegacyBoardsRedirect() {
  const { teamId } = await requireActiveTeam();
  const project = await ensureDefaultProject(teamId);
  redirect(`/p/${project.slug}/boards`);
}
