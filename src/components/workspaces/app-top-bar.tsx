import { CheckSquare, LayoutDashboard, Palette } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { UserMenu } from "./user-menu";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherTeam,
} from "./workspace-switcher";

export type AppTopBarSection = "boards" | "designs" | "tasks";

export interface AppTopBarProps {
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
  userName: string;
  userEmail?: string;
  /**
   * Highlights the matching section link. Pages that aren't a boards /
   * designs / tasks surface (home dashboard, account, team page) leave
   * this undefined so no link is highlighted.
   */
  active?: AppTopBarSection;
  /**
   * Active project slug — when supplied, section nav links go straight
   * to `/p/<slug>/<section>` instead of through the legacy redirect.
   * Pages outside the project surface (home, account, team) leave it
   * undefined; nav still works via the legacy redirect.
   */
  projectSlug?: string;
}

interface SectionLinkSpec {
  id: AppTopBarSection;
  label: string;
  /** When the page knows the project, prefer `/p/<slug>/<section>`. */
  buildHref: (projectSlug: string | undefined) => string;
  Icon: typeof LayoutDashboard;
}

const SECTION_LINKS: SectionLinkSpec[] = [
  {
    id: "boards",
    label: "Boards",
    buildHref: (slug) => (slug ? `/p/${slug}/boards` : "/boards"),
    Icon: LayoutDashboard,
  },
  {
    id: "designs",
    label: "Designs",
    buildHref: (slug) => (slug ? `/p/${slug}/designs` : "/designs"),
    Icon: Palette,
  },
  {
    id: "tasks",
    label: "Tasks",
    buildHref: (slug) => (slug ? `/p/${slug}/tasks` : "/tasks"),
    Icon: CheckSquare,
  },
];

/**
 * Top bar shared by every page that isn't a focused canvas surface.
 *
 * Holds the brand, the team switcher, the section nav (Boards / Designs /
 * Tasks), and the user menu. The board/design *workspaces* use the
 * richer {@link WorkspaceTopBar} which embeds the team switcher inside a
 * breadcrumb instead.
 */
export function AppTopBar({
  teams,
  activeTeamId,
  userName,
  userEmail,
  active,
  projectSlug,
}: AppTopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/60 px-3 backdrop-blur">
      <Link
        href="/"
        className="rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-white/5"
      >
        yxuOS
      </Link>
      <span className="text-zinc-600">/</span>
      <WorkspaceSwitcher teams={teams} activeTeamId={activeTeamId} />

      <nav
        aria-label="Sections"
        className="ml-3 hidden items-center gap-0.5 sm:flex"
      >
        {SECTION_LINKS.map(({ id, label, buildHref, Icon }) => {
          const isActive = id === active;
          return (
            <Link
              key={id}
              href={buildHref(projectSlug)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white/10 text-zinc-50"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto">
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
