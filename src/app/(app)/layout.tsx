import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { QuickSearch } from "@/components/quick-search/quick-search";
import { Toaster } from "@/components/ui/toast";
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

  return (
    <>
      {children}
      {/* Mounted once per authed render. The launcher is fully
          self-contained — it activates on ⌘K from anywhere and
          renders nothing until then. Zero cost when idle. */}
      <QuickSearch />
      {/* In-app toast surface. Lives at the layout level so any
          server action / client interaction below can fire a
          toast via `useToast()` without threading state. */}
      <Toaster />
    </>
  );
}
