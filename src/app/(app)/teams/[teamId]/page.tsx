import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TeamMemberList } from "@/components/teams/team-member-list";
import { TeamAddMemberForm } from "@/components/teams/team-add-member-form";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { requireMembership, type TeamRole } from "@/lib/permissions";
import { listUserTeams } from "@/lib/teams";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  let session: Awaited<ReturnType<typeof requireMembership>>["session"];
  let role: TeamRole;
  try {
    const ctx = await requireMembership(teamId);
    session = ctx.session;
    role = ctx.role;
  } catch {
    notFound();
  }

  const [team, memberRows, teams] = await Promise.all([
    db.query.organization.findFirst({
      where: eq(organization.id, teamId),
      columns: { id: true, name: true, slug: true },
    }),
    db
      .select({
        memberId: member.id,
        role: member.role,
        joinedAt: member.createdAt,
        userId: member.userId,
      })
      .from(member)
      .where(eq(member.organizationId, teamId))
      .orderBy(asc(member.createdAt)),
    listUserTeams(session.user.id),
  ]);

  if (!team) {
    notFound();
  }

  // Pull user details for every member in one shot.
  const userIds = memberRows.map((row) => row.userId);
  const users =
    userIds.length === 0
      ? []
      : await db.query.user.findMany({
          where: (u, { inArray }) => inArray(u.id, userIds),
          columns: {
            id: true,
            name: true,
            email: true,
            username: true,
            displayUsername: true,
          },
        });
  const usersById = new Map(users.map((u) => [u.id, u]));

  const members = memberRows.map((row) => {
    const u = usersById.get(row.userId);
    return {
      memberId: row.memberId,
      userId: row.userId,
      name: u?.name ?? "Unknown user",
      email: u?.email ?? "",
      username: u?.displayUsername ?? u?.username ?? null,
      role: row.role as TeamRole,
      joinedAt: row.joinedAt,
      isYou: row.userId === session.user.id,
    };
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
        <nav className="flex items-center gap-2 text-sm text-zinc-400">
          <Link href="/boards" className="hover:text-zinc-200">
            Boards
          </Link>
          <span className="text-zinc-600">·</span>
          <Link href="/designs" className="hover:text-zinc-200">
            Designs
          </Link>
        </nav>

        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {team.name}
            </h1>
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {role}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage who has access to this team. Anyone added gets full access
            to every board, design, component, and asset.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Members ({members.length})
          </h2>
          <TeamMemberList
            teamId={teamId}
            members={members}
            actorRole={role}
          />
        </section>

        {role !== "member" ? (
          <section className="flex flex-col gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium text-zinc-100">Add a member</h2>
              <p className="text-xs text-muted-foreground">
                Enter their username (the handle they picked at sign-up).
                {role === "owner"
                  ? " You can grant any role."
                  : " Admins can add members only — owners can grant other roles."}
              </p>
            </div>
            <TeamAddMemberForm teamId={teamId} actorRole={role} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const team = await db.query.organization.findFirst({
    where: eq(organization.id, teamId),
    columns: { name: true },
  });
  return { title: team ? `${team.name} · yxuOS` : "Team · yxuOS" };
}
