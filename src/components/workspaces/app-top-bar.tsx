import Link from "next/link";

import { UserMenu } from "./user-menu";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherTeam,
} from "./workspace-switcher";

export interface AppTopBarProps {
  teams: WorkspaceSwitcherTeam[];
  activeTeamId: string;
  userName: string;
  userEmail?: string;
}

/**
 * Minimal top bar for the workspace index pages (`/boards`, `/designs`).
 *
 * Holds the brand, the team switcher, and the user menu. The board/design
 * surfaces use the richer {@link WorkspaceTopBar} which embeds the same
 * switcher inside a breadcrumb.
 */
export function AppTopBar({
  teams,
  activeTeamId,
  userName,
  userEmail,
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

      <div className="ml-auto">
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
