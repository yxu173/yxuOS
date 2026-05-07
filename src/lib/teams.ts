import { eq } from "drizzle-orm";

import { db } from "@/db";
import { member, organization, user } from "@/db/schema";

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
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role as TeamRole,
  }));
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
}
