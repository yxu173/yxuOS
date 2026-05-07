/**
 * Backfill script: for every existing team (organization), ensure there
 * is a default project ("Workspace") and stamp `project_id` on every
 * board, design, task, design_component, design_asset, and attachment
 * the team owns.
 *
 * Idempotent — safe to run multiple times. Runs once between migrations
 * 0010 (which adds the nullable `project_id` columns) and the follow-up
 * migration that flips them to NOT NULL.
 *
 * Usage:
 *   bun scripts/backfill-projects.ts
 *
 * Reads DATABASE_URL from .env.local / .env (bun loads them automatically).
 */
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../src/db";
import {
  attachments,
  boards,
  designAssets,
  designComponents,
  designs,
  projects,
  tasks,
} from "../src/db/schema";

const DEFAULT_SLUG = "workspace";
const DEFAULT_NAME = "Workspace";

async function ensureDefaultProject(teamId: string): Promise<string> {
  const existing = await db.query.projects.findFirst({
    where: and(
      eq(projects.teamId, teamId),
      eq(projects.slug, DEFAULT_SLUG),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const id = nanoid();
  const now = new Date();
  await db.insert(projects).values({
    id,
    teamId,
    name: DEFAULT_NAME,
    slug: DEFAULT_SLUG,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  · created default project ${id} for team ${teamId}`);
  return id;
}

async function stampTeamResources(teamId: string, projectId: string) {
  const targets = [
    { table: boards, label: "boards" },
    { table: designs, label: "designs" },
    { table: tasks, label: "tasks" },
    { table: designComponents, label: "design_components" },
    { table: designAssets, label: "design_assets" },
    { table: attachments, label: "attachments" },
  ] as const;

  for (const { table, label } of targets) {
    const updated = await db
      .update(table)
      .set({ projectId })
      // Only stamp rows where it's still null — keeps the script
      // idempotent. Scope to this team so we never touch another team's
      // rows that happen to share an id (they don't, but defensive).
      .where(and(eq(table.teamId, teamId), isNull(table.projectId)))
      .returning({ id: table.id });
    if (updated.length > 0) {
      console.log(`    · ${label}: stamped ${updated.length} row(s)`);
    }
  }
}

async function main() {
  console.log("→ Projects backfill starting…");

  const teams = await db.query.organization.findMany({
    columns: { id: true, name: true },
  });
  console.log(`  found ${teams.length} team(s)`);

  for (const team of teams) {
    const projectId = await ensureDefaultProject(team.id);
    await stampTeamResources(team.id, projectId);
  }

  console.log("✓ Backfill complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Backfill failed:", err);
    process.exit(1);
  });
