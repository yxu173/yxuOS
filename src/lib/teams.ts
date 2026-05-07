import { eq } from "drizzle-orm";

import { db } from "@/db";
import { member, organization } from "@/db/schema";

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
