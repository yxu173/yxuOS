import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache as reactCache } from "react";

import { db } from "@/db";
import { member, projects } from "@/db/schema";

import { auth } from "./auth";
import { cached, cacheKey } from "./cache";
import { ensureDefaultProject } from "./projects";

/**
 * TTLs are deliberately short. Permissions are the one cache where
 * staleness has security implications — a 30 s window between a role
 * change and the cache catching up is acceptable, but minutes isn't.
 * Invalidations on writes (in `teams/[teamId]/actions.ts`) bring the
 * effective freshness window to ~0 for the team that issued the write.
 */
const MEMBER_TTL = 30; // seconds
const PROJECT_TTL = 60; // seconds

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
 * `getSession` reads the cookie, validates the session, and may hit
 * the DB. Wrapping in `react.cache()` means a layout + page + N
 * server components on the same render all share ONE lookup — a huge
 * speed win on its own, even before Redis enters the picture.
 */
const requireSession = reactCache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
});

async function requireMemberRow(userId: string, teamId: string) {
  // Cache key chosen so role updates can bust `member:user:${userId}`
  // (when one user's role changes) OR `team:${teamId}:members` (when
  // members are added / removed in bulk).
  const key = cacheKey("member", userId, teamId);
  const memberRow = await cached(
    key,
    {
      ttl: MEMBER_TTL,
      tags: [`member:user:${userId}`, `team:${teamId}:members`],
    },
    async () =>
      db.query.member.findFirst({
        where: and(
          eq(member.userId, userId),
          eq(member.organizationId, teamId),
        ),
        columns: { id: true, role: true },
      }),
  );
  if (!memberRow) {
    throw new Error("Not a member of this team");
  }
  return {
    id: memberRow.id,
    role: memberRow.role as TeamRole,
  };
}

/**
 * Resolves the active session, the active team, and the member row that
 * proves the user belongs to that team.
 *
 * Falls back to the user's first team if `session.activeOrganizationId`
 * is null (handles stale sessions from before the org plugin landed).
 */
export async function requireActiveTeam(minRole: TeamRole = "member") {
  const session = await requireSession();

  let activeOrgId = session.session.activeOrganizationId;

  if (!activeOrgId) {
    const firstMember = await cached(
      cacheKey("member", session.user.id, "first"),
      {
        ttl: MEMBER_TTL,
        tags: [`member:user:${session.user.id}`],
      },
      async () =>
        db.query.member.findFirst({
          where: eq(member.userId, session.user.id),
          columns: { organizationId: true },
        }),
    );
    if (!firstMember) {
      throw new Error(
        "No active team. Sign out and back in to claim your personal team.",
      );
    }
    activeOrgId = firstMember.organizationId;
  }

  const { id: memberId, role } = await requireMemberRow(
    session.user.id,
    activeOrgId,
  );

  if (!rolePassesMinimum(role, minRole)) {
    throw new Error(`This action requires the ${minRole} role`);
  }

  return {
    session,
    teamId: activeOrgId,
    role,
    memberId,
  };
}

/**
 * Like {@link requireActiveTeam} but for an explicit team id. Used by
 * `/teams/[teamId]` where the URL — not the session — picks the team.
 *
 * The caller still has to be a member of `teamId`, with a role at least
 * `minRole`. Useful for actions like add/remove member where we want
 * "admin in this specific team", not "admin in active team".
 */
export async function requireMembership(
  teamId: string,
  minRole: TeamRole = "member",
) {
  const session = await requireSession();
  const { id: memberId, role } = await requireMemberRow(
    session.user.id,
    teamId,
  );
  if (!rolePassesMinimum(role, minRole)) {
    throw new Error(`This action requires the ${minRole} role`);
  }
  return { session, teamId, role, memberId };
}

/**
 * Resolves the active project for a given slug under the active team —
 * the workhorse permission gate for everything under `/p/[projectSlug]/`.
 *
 * - Verifies the team membership (same role check as `requireActiveTeam`).
 * - Loads the project by `(team_id, slug)`. Archived projects throw — you
 *   can read them via `requireMembership` directly if needed.
 * - When `slug` is `null` / undefined, falls back to the team's default
 *   project (creating one lazily if the team has none — handles
 *   pre-backfill teams).
 */
export async function requireActiveProject(
  slug: string | null | undefined,
  minRole: TeamRole = "member",
): Promise<{
  session: Awaited<ReturnType<typeof requireSession>>;
  teamId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  role: TeamRole;
  memberId: string;
}> {
  const team = await requireActiveTeam(minRole);

  if (!slug) {
    const fallback = await ensureDefaultProject(team.teamId);
    return {
      session: team.session,
      teamId: team.teamId,
      projectId: fallback.id,
      projectSlug: fallback.slug,
      projectName: fallback.name,
      role: team.role,
      memberId: team.memberId,
    };
  }

  const project = await cached(
    cacheKey("project", team.teamId, slug),
    {
      ttl: PROJECT_TTL,
      tags: [`team:${team.teamId}:projects`],
    },
    async () =>
      db.query.projects.findFirst({
        where: and(
          eq(projects.teamId, team.teamId),
          eq(projects.slug, slug),
        ),
        columns: { id: true, slug: true, name: true, archived: true },
      }),
  );
  if (!project) {
    throw new Error(`Project "${slug}" not found in this team`);
  }
  if (project.archived) {
    throw new Error(`Project "${slug}" is archived`);
  }

  return {
    session: team.session,
    teamId: team.teamId,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    role: team.role,
    memberId: team.memberId,
  };
}
