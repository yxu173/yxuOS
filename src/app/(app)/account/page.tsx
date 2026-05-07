import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/account/profile-form";
import { PasswordForm } from "@/components/account/password-form";
import { AppTopBar } from "@/components/workspaces/app-top-bar";
import { db } from "@/db";
import { account, member, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { listUserTeams } from "@/lib/teams";

export const metadata = {
  title: "Account · yxuOS",
};

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  // Resolve active team (same fallback behaviour as the home dashboard) so
  // the AppTopBar always has a workspace context.
  let teamId = session.session.activeOrganizationId;
  if (!teamId) {
    const firstMember = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
      columns: { organizationId: true },
    });
    teamId = firstMember?.organizationId ?? null;
  }

  const [profile, accounts, teams] = await Promise.all([
    db.query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: {
        id: true,
        name: true,
        email: true,
        username: true,
        displayUsername: true,
      },
    }),
    db.query.account.findMany({
      where: eq(account.userId, session.user.id),
      columns: { providerId: true },
    }),
    listUserTeams(session.user.id),
  ]);

  if (!profile) {
    redirect("/sign-in");
  }

  const hasPassword = accounts.some((row) => row.providerId === "credential");

  return (
    <div className="flex min-h-screen flex-col">
      {teamId ? (
        <AppTopBar
          teams={teams}
          activeTeamId={teamId}
          userName={session.user.name}
          userEmail={session.user.email}
        />
      ) : null}

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
        <nav className="flex items-center gap-2 text-sm text-zinc-400">
          <Link href="/" className="hover:text-zinc-200">
            Home
          </Link>
          <span className="text-zinc-600">·</span>
          <Link href="/boards" className="hover:text-zinc-200">
            Boards
          </Link>
          <span className="text-zinc-600">·</span>
          <Link href="/designs" className="hover:text-zinc-200">
            Designs
          </Link>
        </nav>

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">
            Edit your profile and security settings.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-zinc-100">Profile</h2>
            <p className="text-xs text-muted-foreground">
              Your name shows up on creator badges; your username is how
              teammates add you to teams.
            </p>
          </div>
          <ProfileForm
            initialName={profile.name}
            initialUsername={
              profile.displayUsername ?? profile.username ?? ""
            }
            email={profile.email}
          />
        </section>

        {hasPassword ? (
          <section className="flex flex-col gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium text-zinc-100">Password</h2>
              <p className="text-xs text-muted-foreground">
                Updating signs you out of other browsers automatically.
              </p>
            </div>
            <PasswordForm />
          </section>
        ) : (
          <section className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-medium text-zinc-100">Password</h2>
            <p className="text-xs text-muted-foreground">
              You signed in with a social provider. There&apos;s no password
              on this account.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
