import { desc, eq } from "drizzle-orm";
import {
  Activity,
  ArrowRight,
  CheckSquare,
  LayoutDashboard,
  Palette,
  Sparkles,
  Users,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { ActivityFeed } from "@/components/activity/activity-feed";
import { PriorityIcon } from "@/components/tasks/priority-icon";
import { StatusIcon } from "@/components/tasks/status-icon";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { db } from "@/db";
import { boards, designs, member } from "@/db/schema";
import { listRecentActivity } from "@/lib/activity-list";
import { auth } from "@/lib/auth";
import { listMyOpenTasks } from "@/lib/tasks/list-my-tasks";
import { listUserTeams } from "@/lib/teams";
import { cn } from "@/lib/utils";

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

  const [recentBoards, recentDesigns, teams, activity, myTasks] =
    await Promise.all([
      db.query.boards.findMany({
        where: eq(boards.teamId, teamId),
        orderBy: desc(boards.updatedAt),
        limit: RECENT_LIMIT,
        columns: { id: true, name: true, updatedAt: true },
        with: {
          project: { columns: { slug: true, name: true } },
        },
      }),
      db.query.designs.findMany({
        where: eq(designs.teamId, teamId),
        orderBy: desc(designs.updatedAt),
        limit: RECENT_LIMIT,
        columns: { id: true, name: true, updatedAt: true },
        with: {
          project: { columns: { slug: true, name: true } },
        },
      }),
      listUserTeams(session.user.id),
      listRecentActivity(teamId, 8),
      listMyOpenTasks(session.user.id, teamId, 6),
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

        {myTasks.length > 0 ? (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
                <CheckSquare className="size-3.5" />
                Your open tasks
              </h2>
              <Button asChild size="sm" variant="ghost">
                <Link href="/tasks" className="gap-1">
                  All tasks <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
            <ul className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-white/[0.015] p-1.5">
              {myTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={
                      task.projectSlug
                        ? `/p/${task.projectSlug}/tasks/${task.id}`
                        : `/tasks/${task.id}`
                    }
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.04]"
                  >
                    <PriorityIcon priority={task.priority} />
                    <StatusIcon status={task.status} />
                    <span className="min-w-0 flex-1 truncate text-zinc-100">
                      {task.title}
                    </span>
                    {task.dueDate ? (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] tabular-nums",
                          task.overdue ? "text-red-300" : "text-zinc-500",
                        )}
                      >
                        {task.dueDate.toLocaleDateString("en", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <RecentSection
          title="Recent boards"
          icon={LayoutDashboard}
          items={recentBoards.map((row) => ({
            id: row.id,
            name: row.name,
            updatedAt: row.updatedAt,
            project: row.project
              ? { slug: row.project.slug, name: row.project.name }
              : null,
          }))}
          section="boards"
          allHref="/boards"
          createAction={createBoard}
          createLabel="New board"
          emptyHint="Sketch system architecture, run a retro, brainstorm with the agent."
        />

        <RecentSection
          title="Recent designs"
          icon={Palette}
          items={recentDesigns.map((row) => ({
            id: row.id,
            name: row.name,
            updatedAt: row.updatedAt,
            project: row.project
              ? { slug: row.project.slug, name: row.project.name }
              : null,
          }))}
          section="designs"
          allHref="/designs"
          createAction={createDesign}
          createLabel="New design"
          emptyHint="Mock up a landing page, dashboard, or component spec."
        />

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
              <Activity className="size-3.5" />
              Recent activity
            </h2>
            {activity.length > 0 ? (
              <Button asChild size="sm" variant="ghost">
                <Link
                  href={`/teams/${teamId}`}
                  className="gap-1"
                >
                  See all <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
          <ActivityFeed
            items={activity}
            compact
            emptyHint="When teammates create or update boards and designs, you'll see it here."
          />
        </section>
      </main>
    </div>
  );
}

/* ─── recent section ────────────────────────────── */

interface RecentItem {
  id: string;
  name: string;
  updatedAt: Date;
  project: { slug: string; name: string } | null;
}

function RecentSection({
  title,
  icon: Icon,
  items,
  section,
  allHref,
  createAction,
  createLabel,
  emptyHint,
}: {
  title: string;
  icon: typeof LayoutDashboard;
  items: RecentItem[];
  /** "boards" | "designs" — used to build the per-item project-scoped href. */
  section: "boards" | "designs";
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
          {items.map((item) => {
            const href = item.project
              ? `/p/${item.project.slug}/${section}/${item.id}`
              : `/${section}/${item.id}`;
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className="block focus-visible:outline-none"
                >
                  <Card className="h-24 transition-colors hover:border-foreground/30 focus-visible:border-foreground/40">
                    <CardHeader>
                      <CardTitle className="truncate text-sm">
                        {item.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Updated {dateFormatter.format(item.updatedAt)}
                        {item.project ? (
                          <span className="ml-1 text-zinc-500">
                            · {item.project.name}
                          </span>
                        ) : null}
                      </p>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            );
          })}
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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-16 p-8">
      <header className="flex items-center justify-between pt-4">
        <span className="text-sm font-medium text-zinc-200">yxuOS</span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-col items-center gap-6 pt-12 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
          <Sparkles className="size-3" />
          AI-powered development collaboration
        </span>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
          Whiteboards, designs, and an agent that{" "}
          <span className="text-zinc-400">drafts with you.</span>
        </h1>
        <p className="max-w-xl text-balance text-base text-muted-foreground">
          One workspace for system diagrams, UI mockups, and the AI tools that
          help your team move from idea to spec without switching apps.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/sign-up" className="gap-1.5">
              Create your team <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FeatureCard
          icon={LayoutDashboard}
          title="Boards"
          description="tldraw whiteboards with an agent that drops Mermaid diagrams, sticky notes, and shapes on demand."
        />
        <FeatureCard
          icon={Palette}
          title="Designs"
          description="A custom artboard canvas with a design agent that produces real-looking UI mockups, components, and assets."
        />
        <FeatureCard
          icon={Users}
          title="Teams"
          description="Shared workspaces. Add teammates by username — every board, design, and component is owned by the team."
        />
      </section>

      <footer className="mt-auto border-t border-white/5 pt-6 text-xs text-muted-foreground">
        Built with Next.js, Mastra, and Claude. yxuOS &copy; {new Date().getFullYear()}.
      </footer>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof LayoutDashboard;
  title: string;
  description: string;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-5">
      <Icon className="size-5 text-zinc-300" />
      <h3 className="text-base font-medium text-zinc-100">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </article>
  );
}
