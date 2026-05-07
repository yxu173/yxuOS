"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { member, user } from "@/db/schema";
import { requireMembership, type TeamRole } from "@/lib/permissions";

const ASSIGNABLE_ROLES = new Set<TeamRole>(["owner", "admin", "member"]);

function normaliseUsername(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
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
