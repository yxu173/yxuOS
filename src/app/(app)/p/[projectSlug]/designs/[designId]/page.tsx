import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { listCommentsForSubject } from "@/app/(app)/comments/actions";
import { listDesignAssetsForTeam } from "@/app/(app)/designs/asset-actions";
import { listDesignComponentsForTeam } from "@/app/(app)/designs/component-actions";
import type {
  LibraryAsset,
  LibraryComponent,
} from "@/components/design/component-library-context";
import { DesignShell } from "@/components/design/design-shell";
import type { DesignNode } from "@/components/design/design-node";
import type { Artboard } from "@/components/design/types";
import { db } from "@/db";
import { designs, teamDesignTokens } from "@/db/schema";
import { requireActiveProject } from "@/lib/permissions";
import { listTeamMembers, listUserTeams } from "@/lib/teams";
import { mastra } from "@/mastra";

interface DesignSnapshot {
  artboards?: Artboard[];
}

async function loadInitialMessages(
  threadId: string,
  resourceId: string,
): Promise<UIMessage[]> {
  try {
    const memory = await mastra.getAgentById("designArchitect").getMemory();
    if (!memory) return [];
    const result = await memory.recall({ threadId, resourceId });
    return toAISdkMessages(result.messages, { version: "v6" });
  } catch {
    return [];
  }
}

export default async function DesignPage({
  params,
}: {
  params: Promise<{ projectSlug: string; designId: string }>;
}) {
  const { projectSlug, designId } = await params;

  const { session, teamId, projectId } =
    await requireActiveProject(projectSlug);

  const [
    design,
    userDesigns,
    componentRows,
    assetRows,
    teams,
    members,
    commentRows,
    teamTokenRow,
  ] = await Promise.all([
    db.query.designs.findFirst({
      where: and(
        eq(designs.id, designId),
        eq(designs.teamId, teamId),
        eq(designs.projectId, projectId),
      ),
      columns: {
        id: true,
        name: true,
        snapshot: true,
        threadId: true,
        shareToken: true,
        tokens: true,
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
    db.query.designs.findMany({
      where: and(
        eq(designs.teamId, teamId),
        eq(designs.projectId, projectId),
      ),
      orderBy: desc(designs.updatedAt),
      columns: {
        id: true,
        name: true,
        updatedAt: true,
      },
    }),
    listDesignComponentsForTeam(teamId, projectId),
    listDesignAssetsForTeam(teamId, projectId),
    listUserTeams(session.user.id),
    listTeamMembers(teamId),
    listCommentsForSubject("design", designId),
    db.query.teamDesignTokens.findFirst({
      where: eq(teamDesignTokens.teamId, teamId),
      columns: { tokens: true },
    }),
  ]);

  if (!design) {
    notFound();
  }

  const snapshot = (design.snapshot as DesignSnapshot | null) ?? null;
  const initialArtboards = snapshot?.artboards ?? [];
  const initialMessages = await loadInitialMessages(
    design.threadId,
    session.user.id,
  );

  const components: LibraryComponent[] = componentRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    tree: row.tree as unknown as DesignNode,
  }));
  const assets: LibraryAsset[] = assetRows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    mimeType: row.mimeType,
    size: row.size,
  }));

  const creator = design.owner
    ? {
        name: design.owner.name,
        username: design.owner.displayUsername ?? design.owner.username,
      }
    : null;

  const initialTokens = {
    team: teamTokenRow?.tokens ?? {},
    design: design.tokens ?? {},
  };

  return (
    <DesignShell
      designId={design.id}
      designName={design.name}
      userName={session.user.name}
      userEmail={session.user.email}
      shareToken={design.shareToken}
      initialArtboards={initialArtboards}
      initialMessages={initialMessages}
      initialComments={commentRows}
      members={members.map((m) => ({
        userId: m.userId,
        name: m.name,
        username: m.username,
      }))}
      designs={userDesigns}
      designsHrefBase={`/p/${projectSlug}/designs`}
      components={components}
      assets={assets}
      initialTokens={initialTokens}
      teams={teams}
      activeTeamId={teamId}
      creator={creator}
    />
  );
}
