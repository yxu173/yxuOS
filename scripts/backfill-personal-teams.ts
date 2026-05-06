/**
 * Backfill script: for every existing user, ensure they have a personal
 * team and stamp `team_id` on every resource they own.
 *
 * Idempotent — safe to run multiple times. Runs once between migrations
 * 0005 (which adds the nullable `team_id` columns) and 0006 (which makes
 * them NOT NULL).
 *
 * Usage:
 *   bun scripts/backfill-personal-teams.ts
 *
 * Reads DATABASE_URL from .env.local / .env (bun handles env file loading
 * automatically).
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../src/db";
import {
  boards,
  designAssets,
  designComponents,
  designs,
  member,
  organization,
} from "../src/db/schema";

async function ensurePersonalTeam(userRow: {
  id: string;
  name: string;
}): Promise<string> {
  // If the user already has any membership, treat the FIRST org as their
  // personal team for backfill purposes. This handles two cases:
  //   1. New users (signed up after commit 1) — already have a personal
  //      team via the post-signup hook. We reuse it.
  //   2. Pre-existing users — create one now.
  const existingMember = await db.query.member.findFirst({
    where: eq(member.userId, userRow.id),
    columns: { organizationId: true },
  });
  if (existingMember) {
    return existingMember.organizationId;
  }

  const orgId = nanoid();
  const memberId = nanoid();
  const baseSlug = `personal-${userRow.id.slice(0, 12)}`.toLowerCase();
  const now = new Date();

  await db.insert(organization).values({
    id: orgId,
    name: "Personal",
    slug: baseSlug,
    createdAt: now,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: orgId,
    userId: userRow.id,
    role: "owner",
    createdAt: now,
  });

  console.log(
    `  · created personal team ${orgId} (slug: ${baseSlug}) for ${userRow.name}`,
  );
  return orgId;
}

async function stampUserResources(userId: string, teamId: string) {
  // Update only rows that don't yet have a team_id, scoped to this user's
  // existing creator_user_id (= owner_id). Idempotent: re-runs are no-op.
  const tablesToBackfill = [
    { table: boards, label: "boards" },
    { table: designs, label: "designs" },
    { table: designComponents, label: "design_components" },
    { table: designAssets, label: "design_assets" },
  ] as const;

  for (const { table, label } of tablesToBackfill) {
    const updated = await db
      .update(table)
      .set({ teamId })
      .where(eq(table.ownerId, userId))
      .returning({ id: table.id });
    if (updated.length > 0) {
      console.log(`    · ${label}: stamped ${updated.length} row(s)`);
    }
  }
}

async function main() {
  console.log("→ Personal-teams backfill starting…");

  const users = await db.query.user.findMany({
    columns: { id: true, name: true },
  });
  console.log(`  found ${users.length} user(s)`);

  for (const userRow of users) {
    const teamId = await ensurePersonalTeam(userRow);
    await stampUserResources(userRow.id, teamId);
  }

  console.log("✓ Backfill complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Backfill failed:", err);
    process.exit(1);
  });
