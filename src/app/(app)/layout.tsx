import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Auth-gated layout for every authenticated route.
 *
 * We re-validate the session against the database on every request so a stale
 * cookie can't keep someone signed in after their session is revoked. Server
 * Components inside this layout can call `auth.api.getSession()` again and
 * Next.js will dedupe the request.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
