/**
 * End-to-end smoke: index a small public repo into the brain, then
 * run a couple of semantic queries to confirm `repo_file` chunks
 * actually land in retrieval.
 *
 * Requires:
 *   - DATABASE_URL set (writes to the project_repos + project_knowledge tables)
 *   - Azure / OpenAI embeddings configured (else embeddings are no-ops)
 *   - The first project + team in the DB (we use them as the scope)
 *
 *   bun scripts/repo-index-smoke.ts [owner/repo]
 *
 * Defaults to honojs/hono since we know it indexes cleanly.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { projectRepos, member } from "@/db/schema";
import { runRepoIndex } from "@/lib/rag/indexers/repo";
import { searchProjectKnowledge } from "@/lib/rag/retrieve";
import { parseGitHubUrl } from "@/lib/repos/url";

const arg = process.argv[2] ?? "sindresorhus/slugify";

async function main() {
  const project = await db.query.projects.findFirst();
  if (!project) {
    console.error("No projects in DB; create one through the UI first.");
    process.exit(1);
  }
  // Pick any member of the team as the importedBy.
  const mem = await db.query.member.findFirst({
    where: eq(member.organizationId, project.teamId),
  });
  if (!mem) {
    console.error("No members for that team.");
    process.exit(1);
  }

  const parsed = parseGitHubUrl(arg);
  // Re-use existing row if any.
  const existing = await db.query.projectRepos.findFirst({
    where: eq(projectRepos.projectId, project.id),
  });
  let repoId: string;
  if (existing && existing.owner === parsed.owner.toLowerCase() && existing.repo === parsed.repo.toLowerCase()) {
    console.log(`Reusing repo row ${existing.id} for ${existing.owner}/${existing.repo}@${existing.branch}`);
    repoId = existing.id;
  } else {
    const [inserted] = await db
      .insert(projectRepos)
      .values({
        teamId: project.teamId,
        projectId: project.id,
        owner: parsed.owner.toLowerCase(),
        repo: parsed.repo.toLowerCase(),
        branch: parsed.branch ?? "main",
        accessToken: process.env.GITHUB_TOKEN ?? null,
        status: "pending",
        importedById: mem.userId,
      })
      .returning();
    repoId = inserted.id;
    console.log(`Inserted repo row ${repoId}`);
  }

  console.log("Running indexer...");
  const t0 = Date.now();
  await runRepoIndex(repoId);
  const ms = Date.now() - t0;

  const row = await db.query.projectRepos.findFirst({
    where: eq(projectRepos.id, repoId),
  });
  console.log(`\nDone in ${ms}ms. Status: ${row?.status}`);
  console.log(`  indexed=${row?.indexedFiles}  skipped=${row?.skippedFiles}  total=${row?.totalFiles}`);
  if (row?.error) console.log(`  error: ${row.error}`);

  // Try a few queries.
  console.log("\n=== Sample queries ===");
  for (const q of ["main entry point", "how does the slugify function work", "input validation"]) {
    const hits = await searchProjectKnowledge({
      projectId: project.id,
      query: q,
      k: 3,
      kinds: ["repo_file"],
    });
    console.log(`\n? "${q}"`);
    for (const h of hits) {
      const path = ((h.metadata ?? {}) as { path?: string }).path ?? "?";
      console.log(`  ${h.similarity.toFixed(3)}  ${path}  ${h.anchor ?? ""}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
