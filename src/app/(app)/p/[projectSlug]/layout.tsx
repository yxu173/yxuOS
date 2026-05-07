import { notFound } from "next/navigation";

import { requireActiveProject } from "@/lib/permissions";

/**
 * Project-scoped layout. Validates that the slug in the URL points at a
 * non-archived project on the active team — anything else 404s.
 *
 * The actual project context (id, name, slug) gets re-resolved by each
 * page that needs it via `requireActiveProject(slug)`. Re-resolving is
 * cheap (one indexed query) and keeps each page self-contained for
 * Server Component caching.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;

  try {
    await requireActiveProject(projectSlug);
  } catch {
    notFound();
  }

  return <>{children}</>;
}
