import {
  CheckSquare,
  FilePen,
  FilePlus,
  FileX2,
  Globe,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Palette,
  Tag,
  UserCog,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/tasks/task-types";
import Link from "next/link";

import type { ActivityListItem } from "@/lib/activity-list";
import { cn } from "@/lib/utils";

export interface ActivityFeedProps {
  items: ActivityListItem[];
  /** Render the feed compact (no actor avatars, single-line entries). */
  compact?: boolean;
  /** Friendly empty-state copy. */
  emptyHint?: string;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const RELATIVE_FMT = new Intl.RelativeTimeFormat("en", { style: "short" });

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 90) return RELATIVE_FMT.format(-1, "minute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 45) return RELATIVE_FMT.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return RELATIVE_FMT.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return RELATIVE_FMT.format(-days, "day");
  return dateFormatter.format(date);
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

interface VerbVisual {
  icon: LucideIcon;
  /** A short verb phrase, e.g. "created board". */
  phrase: string;
  /** True when subject_id should be a clickable link. */
  link?: boolean;
}

/**
 * Maps a (verb + subjectType) pair to an icon + phrase. Anything we
 * don't have a special case for falls through to a generic
 * `verb subjectType` rendering.
 */
function visualForRow(item: ActivityListItem): VerbVisual {
  const key = `${item.verb}:${item.subjectType}`;
  switch (key) {
    case "created:board":
      return { icon: FilePlus, phrase: "created board", link: true };
    case "created:design":
      return { icon: FilePlus, phrase: "created design", link: true };
    case "created:task":
      return { icon: FilePlus, phrase: "created task", link: true };
    case "renamed:board":
      return { icon: FilePen, phrase: "renamed board", link: true };
    case "renamed:design":
      return { icon: FilePen, phrase: "renamed design", link: true };
    case "renamed:task":
      return { icon: FilePen, phrase: "renamed task", link: true };
    case "updated:task":
      return { icon: FilePen, phrase: "updated task", link: true };
    case "deleted:board":
      return { icon: FileX2, phrase: "deleted board" };
    case "deleted:design":
      return { icon: FileX2, phrase: "deleted design" };
    case "deleted:task":
      return { icon: FileX2, phrase: "deleted task" };
    case "shared:board":
    case "shared:design":
      return { icon: Globe, phrase: "shared", link: true };
    case "unshared:board":
    case "unshared:design":
      return { icon: Globe, phrase: "made private", link: true };
    case "commented:board":
      return { icon: MessageCircle, phrase: "commented on board", link: true };
    case "commented:design":
      return { icon: MessageCircle, phrase: "commented on design", link: true };
    case "commented:task":
      return { icon: MessageCircle, phrase: "commented on task", link: true };
    case "reassigned:task":
      return { icon: UserCog, phrase: "reassigned task", link: true };
    case "status_changed:task": {
      const status = (item.metadata?.status as TaskStatus | undefined) ?? null;
      const label = status ? TASK_STATUS_LABELS[status] : null;
      return {
        icon: CheckSquare,
        phrase: label ? `moved task to ${label} ·` : "updated task status on",
        link: true,
      };
    }
    case "added_member:member":
      return { icon: UserPlus, phrase: "added member" };
    case "removed_member:member":
      return { icon: UserMinus, phrase: "removed member" };
    case "left:member":
      return { icon: LogOut, phrase: "left the team" };
    case "renamed_team:team":
      return { icon: Tag, phrase: "renamed team to" };
    default:
      switch (item.subjectType) {
        case "board":
          return {
            icon: LayoutDashboard,
            phrase: `${item.verb} board`,
            link: true,
          };
        case "design":
          return { icon: Palette, phrase: `${item.verb} design`, link: true };
        case "task":
          return {
            icon: CheckSquare,
            phrase: `${item.verb} task`,
            link: true,
          };
        default:
          return { icon: Tag, phrase: `${item.verb} ${item.subjectType}` };
      }
  }
}

function hrefForRow(item: ActivityListItem): string | null {
  // When the activity row carries a project slug (boards / designs /
  // tasks resolved via the join in `listRecentActivity`), build the
  // canonical project-scoped URL. Otherwise fall back to the legacy
  // path which still redirects.
  const slug = item.projectSlug;
  if (item.subjectType === "board") {
    return slug ? `/p/${slug}/boards/${item.subjectId}` : `/boards/${item.subjectId}`;
  }
  if (item.subjectType === "design") {
    return slug ? `/p/${slug}/designs/${item.subjectId}` : `/designs/${item.subjectId}`;
  }
  if (item.subjectType === "task") {
    return slug ? `/p/${slug}/tasks/${item.subjectId}` : `/tasks/${item.subjectId}`;
  }
  return null;
}

export function ActivityFeed({
  items,
  compact = false,
  emptyHint,
}: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
        {emptyHint ?? "Nothing has happened on this team yet."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const visual = visualForRow(item);
        const href = visual.link ? hrefForRow(item) : null;
        const Icon = visual.icon;
        const subjectLabel = item.subjectName ?? "(untitled)";
        const subjectNode = href ? (
          <Link
            href={href}
            className="font-medium text-zinc-100 underline-offset-2 hover:underline"
          >
            {subjectLabel}
          </Link>
        ) : (
          <span className="font-medium text-zinc-100">{subjectLabel}</span>
        );

        return (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.02]",
              compact && "py-1.5",
            )}
          >
            {!compact ? (
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-200">
                {initials(item.actor.name)}
              </span>
            ) : (
              <Icon className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="break-words text-sm leading-snug text-zinc-300">
                <span className="font-medium text-zinc-100">
                  {item.actor.name}
                </span>{" "}
                {visual.phrase} {subjectNode}
                {visual.phrase === "renamed team to" ? null : null}
              </p>
              <p
                className="text-[11px] text-zinc-500"
                title={dateFormatter.format(item.createdAt)}
              >
                {relativeTime(item.createdAt)}
              </p>
            </div>
            {!compact ? (
              <Icon className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
