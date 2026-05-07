import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

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
import { designs } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";
import { listUserTeams } from "@/lib/teams";
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
  params: Promise<{ designId: string }>;
}) {
  const { designId } = await params;

  const { session, teamId } = await requireActiveTeam();

  const [design, userDesigns, componentRows, assetRows, teams] =
    await Promise.all([
      db.query.designs.findFirst({
        where: and(eq(designs.id, designId), eq(designs.teamId, teamId)),
        columns: {
          id: true,
          name: true,
          snapshot: true,
          threadId: true,
          shareToken: true,
        },
      }),
      db.query.designs.findMany({
        where: eq(designs.teamId, teamId),
        orderBy: desc(designs.updatedAt),
        columns: {
          id: true,
          name: true,
          updatedAt: true,
        },
      }),
      listDesignComponentsForTeam(teamId),
      listDesignAssetsForTeam(teamId),
      listUserTeams(session.user.id),
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

  return (
    <DesignShell
      designId={design.id}
      designName={design.name}
      userName={session.user.name}
      userEmail={session.user.email}
      shareToken={design.shareToken}
      initialArtboards={initialArtboards}
      initialMessages={initialMessages}
      designs={userDesigns}
      components={components}
      assets={assets}
      teams={teams}
      activeTeamId={teamId}
    />
  );
}
