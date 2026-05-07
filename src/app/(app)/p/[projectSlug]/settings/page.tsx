import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ProjectSettingsForm } from "@/components/workspaces/project-settings-form";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { requireActiveProject } from "@/lib/permissions";
import { listProjectsForTeam } from "@/lib/projects";
import { listUserTeams } from "@/lib/teams";

interface PageProps {
  params: Promise<{ projectSlug: string }>;
}

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { projectSlug } = await params;

  const { session, teamId, projectId, projectName, role } =
    await requireActiveProject(projectSlug);

  const [teams, projects] = await Promise.all([
    listUserTeams(session.user.id),
    listProjectsForTeam(teamId),
  ]);

  const canManage = role === "owner" || role === "admin";

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
        projectSlug={projectSlug}
        projects={projects}
      />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
        <nav className="flex items-center gap-2 text-sm text-zinc-400">
          <Link
            href={`/p/${projectSlug}/boards`}
            className="inline-flex items-center gap-1 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3.5" />
            {projectName}
          </Link>
        </nav>

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Project settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Rename, recolour, or archive the project. Archive removes it
            from the switcher without deleting any boards, designs, or
            tasks; un-archiving restores access.
          </p>
        </header>

        {canManage ? (
          <ProjectSettingsForm
            projectId={projectId}
            projectSlug={projectSlug}
            initialName={projectName}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-muted-foreground">
            Only team owners and admins can change project settings.
          </p>
        )}
      </main>
    </div>
  );
}
