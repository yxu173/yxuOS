"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { member, organization, user } from "@/db/schema";
import { requireMembership, type TeamRole } from "@/lib/permissions";

const ASSIGNABLE_ROLES = new Set<TeamRole>(["owner", "admin", "member"]);

function normaliseUsername(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Personal teams are auto-created on signup with a slug like
 * `personal-<userId-prefix>`. We refuse to rename or delete them so a
 * user can never accidentally drop their fallback workspace.
 */
function isPersonalSlug(slug: string): boolean {
  return slug.startsWith("personal-");
}

/* ─── add member ──────────────────────────────────────── */

export async function addMemberByUsername(
  teamId: string,
  rawUsername: string,
  rawRole: TeamRole,
): Promise<{ memberId: string; userName: string }> {
  // Admins and owners can add members. Owners can add anyone in any role;
  // admins can add members only.
  const { role: actorRole } = await requireMembership(teamId, "admin");

  const role: TeamRole = ASSIGNABLE_ROLES.has(rawRole) ? rawRole : "member";
  if (actorRole !== "owner" && role !== "member") {
    throw new Error("Only owners can grant the admin or owner role");
  }

  const username = normaliseUsername(rawUsername);
  if (!username) {
    throw new Error("Username is required");
  }

  const target = await db.query.user.findFirst({
    where: eq(user.username, username),
    columns: { id: true, name: true },
  });
  if (!target) {
    throw new Error(`No user with username @${username}`);
  }

  const existing = await db.query.member.findFirst({
    where: and(
      eq(member.userId, target.id),
      eq(member.organizationId, teamId),
    ),
    columns: { id: true },
  });
  if (existing) {
    throw new Error(`@${username} is already on this team`);
  }

  const [created] = await db
    .insert(member)
    .values({
      id: nanoid(),
      organizationId: teamId,
      userId: target.id,
      role,
      createdAt: new Date(),
    })
    .returning({ id: member.id });

  revalidatePath(`/teams/${teamId}`);
  return { memberId: created.id, userName: target.name };
}

/* ─── remove member ───────────────────────────────────── */

export async function removeTeamMember(teamId: string, memberId: string) {
  const { role: actorRole, session } = await requireMembership(
    teamId,
    "admin",
  );

  const target = await db.query.member.findFirst({
    where: and(eq(member.id, memberId), eq(member.organizationId, teamId)),
    columns: { id: true, role: true, userId: true },
  });
  if (!target) {
    throw new Error("Member not found");
  }
  const targetRole = target.role as TeamRole;

  // Stop people from removing themselves through this action — there's a
  // separate "leave team" flow for that with extra confirmation.
  if (target.userId === session.user.id) {
    throw new Error(
      "Use Leave team to remove yourself; this action is for other members",
    );
  }
  // Owners can remove anyone but the last owner; admins can remove members
  // only.
  if (actorRole !== "owner" && targetRole !== "member") {
    throw new Error("Only owners can remove admins or other owners");
  }
  if (targetRole === "owner") {
    const owners = await db.query.member.findMany({
      where: and(eq(member.organizationId, teamId), eq(member.role, "owner")),
      columns: { id: true },
    });
    if (owners.length <= 1) {
      throw new Error("Can't remove the last owner of a team");
    }
  }

  await db
    .delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, teamId)));

  revalidatePath(`/teams/${teamId}`);
}

/* ─── change role ─────────────────────────────────────── */

export async function updateMemberRole(
  teamId: string,
  memberId: string,
  rawRole: TeamRole,
) {
  // Only owners can change roles.
  const { session } = await requireMembership(teamId, "owner");

  const role: TeamRole = ASSIGNABLE_ROLES.has(rawRole) ? rawRole : "member";

  const target = await db.query.member.findFirst({
    where: and(eq(member.id, memberId), eq(member.organizationId, teamId)),
    columns: { id: true, role: true, userId: true },
  });
  if (!target) {
    throw new Error("Member not found");
  }

  // Don't let an owner downgrade themselves if they're the last owner —
  // that would lock the team out of role changes forever.
  if (
    target.userId === session.user.id &&
    target.role === "owner" &&
    role !== "owner"
  ) {
    const owners = await db.query.member.findMany({
      where: and(eq(member.organizationId, teamId), eq(member.role, "owner")),
      columns: { id: true },
    });
    if (owners.length <= 1) {
      throw new Error(
        "Promote another owner before stepping down — a team needs at least one owner",
      );
    }
  }

  await db
    .update(member)
    .set({ role })
    .where(and(eq(member.id, memberId), eq(member.organizationId, teamId)));

  revalidatePath(`/teams/${teamId}`);
}

/* ─── rename team ─────────────────────────────────────── */

const MAX_TEAM_NAME = 60;

export async function renameTeam(teamId: string, rawName: string) {
  await requireMembership(teamId, "owner");

  const team = await db.query.organization.findFirst({
    where: eq(organization.id, teamId),
    columns: { id: true, slug: true },
  });
  if (!team) throw new Error("Team not found");
  if (isPersonalSlug(team.slug)) {
    throw new Error("Personal teams can't be renamed");
  }

  const trimmed = rawName.trim().slice(0, MAX_TEAM_NAME);
  if (!trimmed) throw new Error("Team name is required");

  await db
    .update(organization)
    .set({ name: trimmed })
    .where(eq(organization.id, teamId));

  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/boards");
  revalidatePath("/designs");
}

/* ─── delete team ─────────────────────────────────────── */

export async function deleteTeam(teamId: string, confirmName: string) {
  const { session } = await requireMembership(teamId, "owner");

  const team = await db.query.organization.findFirst({
    where: eq(organization.id, teamId),
    columns: { id: true, name: true, slug: true },
  });
  if (!team) throw new Error("Team not found");

  if (isPersonalSlug(team.slug)) {
    throw new Error(
      "Personal teams can't be deleted — they're your fallback workspace",
    );
  }

  if (confirmName.trim() !== team.name) {
    throw new Error("Type the team name exactly to confirm");
  }

  // Check the user has at least one other team to fall back to. Without
  // this, deleting their last team would leave them with nowhere to land
  // after redirect. We pull every membership and pick one in JS — keeps
  // the query simple and there's never enough teams per user to matter.
  const memberships = await db.query.member.findMany({
    where: eq(member.userId, session.user.id),
    columns: { organizationId: true },
  });
  const fallback = memberships.find((m) => m.organizationId !== teamId);
  if (!fallback) {
    throw new Error(
      "Can't delete your only team — create another one first or stay in your personal team",
    );
  }

  // Cascading FKs (team_id ON DELETE CASCADE on boards, designs,
  // components, assets, member, invitation) handle the rest.
  await db.delete(organization).where(eq(organization.id, teamId));

  revalidatePath("/boards");
  revalidatePath("/designs");
  return { fallbackTeamId: fallback.organizationId };
}

/* ─── leave team ──────────────────────────────────────── */

export async function leaveTeam(teamId: string) {
  const { session, role, memberId } = await requireMembership(teamId);

  if (role === "owner") {
    const owners = await db.query.member.findMany({
      where: and(eq(member.organizationId, teamId), eq(member.role, "owner")),
      columns: { id: true },
    });
    if (owners.length <= 1) {
      throw new Error(
        "Promote another owner before leaving — a team needs at least one owner",
      );
    }
  }

  await db
    .delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, teamId)));

  // Touch a path the user can still see post-leave.
  revalidatePath("/boards");
  revalidatePath("/designs");
  return { userId: session.user.id };
}
