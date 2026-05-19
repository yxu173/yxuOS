import { eq } from "drizzle-orm";

import { db } from "@/db";
import { member, organization, user } from "@/db/schema";

import { cached, cacheKey } from "./cache";
import type { TeamRole } from "./permissions";

export interface UserTeam {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
}

/**
 * Lists every team `userId` belongs to, with their role on each. Server-only.
 *
 * Used by the workspace switcher in the top bar — we fetch this once on the
 * server and pass it into the client switcher so there's no flash of empty
 * state.
 */
export async function listUserTeams(userId: string): Promise<UserTeam[]> {
  // Hit by the top-bar workspace switcher on every authenticated page.
  // Only changes when the user joins / leaves / is removed from a team,
  // all of which bust `member:user:${userId}` already.
  return cached(
    cacheKey("user-teams", userId),
    { ttl: 300, tags: [`member:user:${userId}`] },
    async () => {
      const rows = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: member.role,
        })
        .from(member)
        .innerJoin(
          organization,
          eq(member.organizationId, organization.id),
        )
        .where(eq(member.userId, userId));

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: row.role as TeamRole,
      }));
    },
  );
}

export interface TeamMember {
  userId: string;
  name: string;
  username: string | null;
}

/**
 * Lists every member of a team with the minimum fields the UI needs for
 * @-mention autocomplete. Light enough to call on every board / design
 * load without paginating.
 */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  // Called from every board / design page for @-mention autocomplete.
  // Churn is rare — add / remove / role-change already bust the
  // `team:${teamId}:members` tag from the team actions module.
  return cached(
    cacheKey("team-members", teamId),
    { ttl: 300, tags: [`team:${teamId}:members`] },
    async () => {
      const rows = await db
        .select({
          userId: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, teamId));

      return rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        username: row.displayUsername ?? row.username,
      }));
    },
  );
}
