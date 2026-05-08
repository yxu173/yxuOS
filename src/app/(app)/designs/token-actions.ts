"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { designs, teamDesignTokens } from "@/db/schema";
import { requireActiveTeam } from "@/lib/permissions";

/**
 * Server-side read/write of design tokens. Two scopes:
 *
 * - **Team defaults** (`team_design_tokens`): one row per team. The
 *   brand baseline.
 * - **Per-design overrides** (`designs.tokens` jsonb column): per-key
 *   override of the team baseline for one design.
 *
 * Both are flat `Record<dotted-path, string|number>` blobs. Reads
 * happen on the server (initial page hydration, agent's `list_tokens`
 * tool); writes happen via `set_tokens`.
 */

export interface TokenSet {
  /** Team-default tokens. Empty `{}` if the team hasn't set any. */
  team: Record<string, string | number>;
  /** Per-design override tokens. Empty `{}` if the design has none. */
  design: Record<string, string | number>;
}

/**
 * Fetch both scopes in one round-trip. Used by:
 * - The design page server component (hydrates the renderer).
 * - The agent's `list_tokens` tool (sees both scopes so it can decide
 *   where to write).
 */
export async function listDesignTokens(designId: string): Promise<TokenSet> {
  const { teamId } = await requireActiveTeam();

  const [design, teamRow] = await Promise.all([
    db.query.designs.findFirst({
      where: eq(designs.id, designId),
      columns: { teamId: true, tokens: true },
    }),
    db.query.teamDesignTokens.findFirst({
      where: eq(teamDesignTokens.teamId, teamId),
      columns: { tokens: true },
    }),
  ]);

  if (!design) {
    throw new Error(`Design "${designId}" not found.`);
  }
  if (design.teamId !== teamId) {
    // Belongs to another team — refuse rather than leaking.
    throw new Error(`Design "${designId}" is not in the active team.`);
  }

  return {
    team: teamRow?.tokens ?? {},
    design: design.tokens ?? {},
  };
}

/**
 * Same as `listDesignTokens` but for the public share page, which
 * doesn't have a session. Reads tokens straight from the row without
 * the team-scope check (the share token already gates access).
 */
export async function listDesignTokensForShare(
  designId: string,
): Promise<TokenSet> {
  const design = await db.query.designs.findFirst({
    where: eq(designs.id, designId),
    columns: { teamId: true, tokens: true },
  });
  if (!design) {
    throw new Error(`Design "${designId}" not found.`);
  }
  const teamRow = await db.query.teamDesignTokens.findFirst({
    where: eq(teamDesignTokens.teamId, design.teamId),
    columns: { tokens: true },
  });
  return {
    team: teamRow?.tokens ?? {},
    design: design.tokens ?? {},
  };
}

/**
 * Patch a design's per-design tokens. `patch` keys overwrite any
 * existing entries; passing an explicit `null` for a key removes it
 * (falls back to the team default at resolution time).
 */
export async function patchDesignTokens(input: {
  designId: string;
  patch: Record<string, string | number | null>;
}): Promise<{ tokens: Record<string, string | number> }> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.designs.findFirst({
    where: eq(designs.id, input.designId),
    columns: { teamId: true, tokens: true },
  });
  if (!existing) throw new Error(`Design "${input.designId}" not found.`);
  if (existing.teamId !== teamId) {
    throw new Error(`Design "${input.designId}" is not in the active team.`);
  }

  const next: Record<string, string | number> = { ...(existing.tokens ?? {}) };
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }

  await db
    .update(designs)
    .set({ tokens: next, updatedAt: new Date() })
    .where(eq(designs.id, input.designId));

  revalidatePath("/designs");
  return { tokens: next };
}

/**
 * Patch the team's default tokens. Same patch-with-nullable semantics
 * as `patchDesignTokens` (passing `null` removes the key, letting
 * design-scope or literals win at the next level).
 *
 * Inserts a row if the team doesn't have one yet. PK is `teamId` so
 * there's at most one row per team.
 */
export async function patchTeamDesignTokens(input: {
  patch: Record<string, string | number | null>;
}): Promise<{ tokens: Record<string, string | number> }> {
  const { teamId } = await requireActiveTeam();

  const existing = await db.query.teamDesignTokens.findFirst({
    where: eq(teamDesignTokens.teamId, teamId),
    columns: { tokens: true },
  });

  const next: Record<string, string | number> = { ...(existing?.tokens ?? {}) };
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }

  if (existing) {
    await db
      .update(teamDesignTokens)
      .set({ tokens: next, updatedAt: new Date() })
      .where(eq(teamDesignTokens.teamId, teamId));
  } else {
    await db.insert(teamDesignTokens).values({
      teamId,
      tokens: next,
    });
  }

  revalidatePath("/designs");
  return { tokens: next };
}
