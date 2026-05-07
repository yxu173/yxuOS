import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { member } from "@/db/schema";

import { auth } from "./auth";

/* ─── Roles ─────────────────────────────────────────── */

export type TeamRole = "owner" | "admin" | "member";

const ROLE_RANK: Record<TeamRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

function rolePassesMinimum(role: TeamRole, minRole: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/* ─── Helpers ───────────────────────────────────────── */

/**
 * Resolves the active session, the active team, and the member row that
 * proves the user belongs to that team.
 *
 * Falls back to the user's first team if `session.activeOrganizationId`
 * is null (handles stale sessions from before the org plugin landed).
 */
export async function requireActiveTeam(minRole: TeamRole = "member") {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    throw new Error("Unauthorized");
  }

  let activeOrgId = session.session.activeOrganizationId;

  if (!activeOrgId) {
    const firstMember = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
      columns: { organizationId: true },
    });
    if (!firstMember) {
      throw new Error(
        "No active team. Sign out and back in to claim your personal team.",
      );
    }
    activeOrgId = firstMember.organizationId;
  }

  const memberRow = await db.query.member.findFirst({
    where: and(
      eq(member.userId, session.user.id),
      eq(member.organizationId, activeOrgId),
    ),
    columns: { id: true, role: true },
  });
  if (!memberRow) {
    throw new Error("Not a member of the active team");
  }

  const role = memberRow.role as TeamRole;
  if (!rolePassesMinimum(role, minRole)) {
    throw new Error(`This action requires the ${minRole} role`);
  }

  return {
    session,
    teamId: activeOrgId,
    role,
    memberId: memberRow.id,
  };
}
