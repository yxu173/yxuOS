"use client";

import { CheckSquare, LayoutDashboard, Palette } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type ActiveWorkspace = "boards" | "designs" | "tasks";

export interface WorkspaceTabsProps {
  active: ActiveWorkspace;
}

const TABS: Array<{
  id: ActiveWorkspace;
  label: string;
  href: string;
  Icon: typeof LayoutDashboard;
}> = [
  {
    id: "boards",
    label: "Boards",
    href: "/boards",
    Icon: LayoutDashboard,
  },
  {
    id: "designs",
    label: "Designs",
    href: "/designs",
    Icon: Palette,
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    Icon: CheckSquare,
  },
];

export function WorkspaceTabs({ active }: WorkspaceTabsProps) {
  return (
    <nav
      aria-label="Workspace switcher"
      className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-1"
    >
      {TABS.map(({ id, label, href, Icon }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
  );
}
