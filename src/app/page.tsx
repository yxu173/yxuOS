import { desc, eq } from "drizzle-orm";
import { ArrowRight, LayoutDashboard, Palette } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { db } from "@/db";
import { boards, designs, member } from "@/db/schema";
import { auth } from "@/lib/auth";
import { listUserTeams } from "@/lib/teams";

import { createBoard } from "./(app)/boards/actions";
import { createDesign } from "./(app)/designs/actions";

const RECENT_LIMIT = 6;

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return <SignedOutLanding />;
  }

  // Resolve active team — tolerate stale sessions by falling back to the
  // user's first membership.
  let teamId = session.session.activeOrganizationId;
  if (!teamId) {
    const firstMember = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
      columns: { organizationId: true },
    });
    teamId = firstMember?.organizationId ?? null;
  }

  if (!teamId) {
    // Should never happen — every user gets a personal team at sign-up. But
    // if it does (e.g. a backfill bug), bail to a safe page.
    return <SignedOutLanding />;
  }

  const [recentBoards, recentDesigns, teams] = await Promise.all([
    db.query.boards.findMany({
      where: eq(boards.teamId, teamId),
      orderBy: desc(boards.updatedAt),
      limit: RECENT_LIMIT,
      columns: { id: true, name: true, updatedAt: true },
    }),
    db.query.designs.findMany({
      where: eq(designs.teamId, teamId),
      orderBy: desc(designs.updatedAt),
      limit: RECENT_LIMIT,
      columns: { id: true, name: true, updatedAt: true },
    }),
    listUserTeams(session.user.id),
  ]);

  const activeTeam = teams.find((t) => t.id === teamId);
  const isEmpty = recentBoards.length === 0 && recentDesigns.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        teams={teams}
        activeTeamId={teamId}
        userName={session.user.name}
        userEmail={session.user.email}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {session.user.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeTeam
              ? `Working in ${activeTeam.name}.`
              : "Pick a board or design to jump back in."}
          </p>
        </header>

        {isEmpty ? <EmptyState /> : null}

        <RecentSection
          title="Recent boards"
          icon={LayoutDashboard}
          items={recentBoards}
          hrefBase="/boards"
          allHref="/boards"
          createAction={createBoard}
          createLabel="New board"
          emptyHint="Sketch system architecture, run a retro, brainstorm with the agent."
        />

        <RecentSection
          title="Recent designs"
          icon={Palette}
          items={recentDesigns}
          hrefBase="/designs"
          allHref="/designs"
          createAction={createDesign}
          createLabel="New design"
          emptyHint="Mock up a landing page, dashboard, or component spec."
        />
      </main>
    </div>
  );
}

/* ─── recent section ────────────────────────────── */

interface RecentItem {
  id: string;
  name: string;
  updatedAt: Date;
}

function RecentSection({
  title,
  icon: Icon,
  items,
  hrefBase,
  allHref,
  createAction,
  createLabel,
  emptyHint,
}: {
  title: string;
  icon: typeof LayoutDashboard;
  items: RecentItem[];
  hrefBase: string;
  allHref: string;
  createAction: () => Promise<void>;
  createLabel: string;
  emptyHint: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
          <Icon className="size-3.5" />
          {title}
        </h2>
        <div className="flex items-center gap-2">
          <form action={createAction}>
            <Button type="submit" size="sm" variant="outline">
              {createLabel}
            </Button>
          </form>
          {items.length > 0 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={allHref} className="gap-1">
                See all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="grid h-32 place-items-center border-dashed bg-transparent">
          <p className="text-center text-sm text-muted-foreground">
            {emptyHint}
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`${hrefBase}/${item.id}`}
                className="block focus-visible:outline-none"
              >
                <Card className="h-24 transition-colors hover:border-foreground/30 focus-visible:border-foreground/40">
                  <CardHeader>
                    <CardTitle className="truncate text-sm">
                      {item.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Updated {dateFormatter.format(item.updatedAt)}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── empty state ────────────────────────────────── */

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <h2 className="text-base font-medium text-zinc-100">
        Your workspace is empty
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Spin up your first board or design and let the agent help you draft it.
      </p>
    </section>
  );
}

/* ─── signed-out landing ─────────────────────────── */

function SignedOutLanding() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">yxuOS</h1>
      <p className="max-w-md text-center text-muted-foreground">
        AI-powered whiteboards and design surfaces for thinking through
        systems with your team.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-up">Create account</Link>
        </Button>
      </div>
    </main>
  );
}
