/**
 * RAG smoke test: end-to-end sanity check for the project brain.
 *
 * Picks an arbitrary project (first one in the DB, or one passed as
 * an argument), upserts a synthetic note, runs three semantic
 * queries against it, and cleans up — leaving no trace in the
 * `project_knowledge` table.
 *
 * Usage:
 *   bun scripts/rag-smoke.ts            # auto-pick first project
 *   bun scripts/rag-smoke.ts <id>       # use a specific project id
 *
 * Exits 0 on success, 1 on failure. The intended interaction model
 * is "run it, eyeball the similarities, ship it."
 */
import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { projectKnowledge, projects } from "../src/db/schema";
import { chunkText } from "../src/lib/rag/chunk";
import { isEmbeddingsEnabled } from "../src/lib/rag/embed";
import { searchProjectKnowledge } from "../src/lib/rag/retrieve";
import {
  deleteKnowledgeForSource,
  upsertKnowledge,
} from "../src/lib/rag/upsert";

const SOURCE_TYPE = "research_note" as const;
const SOURCE_ID = "smoke-test-note-id";

async function main() {
  console.log("--- RAG smoke test ---");

  if (!isEmbeddingsEnabled()) {
    console.error(
      "No embedding provider configured. Set either the Azure pair\n" +
        "  AZURE_EMBEDDINGS_ENDPOINT + AZURE_EMBEDDINGS_API_KEY\n" +
        "or OPENAI_API_KEY. Aborting.",
    );
    process.exit(1);
  }

  // Resolve target project.
  const projectId = process.argv[2];
  const project = projectId
    ? await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
    : await db.query.projects.findFirst();

  if (!project) {
    console.error("No project found. Create one in the app first.");
    process.exit(1);
  }
  console.log(`Project: ${project.name} (${project.id})`);

  // Synthesise a small but distinctive document. Three sections,
  // each with its own vocabulary so similarities don't collapse
  // to a single cluster.
  const doc = `
We are migrating our authentication system to OIDC. After spiking
both Auth0 and Clerk, we landed on Clerk because the magic-link UX
is unbeatable and the React hooks integrate with our existing
session model with almost no glue.

For the data layer, we're standardising on Drizzle ORM with
Postgres on Neon. The migration story is solid, drizzle-kit
handles introspection on existing tables, and we keep type safety
end-to-end without resorting to runtime guards.

For the frontend, we're sticking with Next.js 16 (turbopack) but
considering TanStack Start for any greenfield work where we don't
need RSC. The decision matrix from the comparison report points
toward Next.js for anything user-facing and TanStack Start for
internal tooling where we want a tighter dev loop.
  `.trim();

  const chunks = chunkText(doc);
  console.log(`Chunked into ${chunks.length} pieces`);

  // Ensure the smoke row doesn't already exist (idempotence on
  // repeated runs).
  await deleteKnowledgeForSource(SOURCE_TYPE, SOURCE_ID);

  const upsertResult = await upsertKnowledge({
    teamId: project.teamId,
    projectId: project.id,
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    title: "Smoke test note",
    metadata: { smokeTest: true },
    chunks,
  });
  console.log("Upsert result:", upsertResult);

  // Verify rows actually landed.
  const rows = await db
    .select()
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, SOURCE_TYPE),
        eq(projectKnowledge.sourceId, SOURCE_ID),
      ),
    );
  console.log(`Inserted ${rows.length} rows`);
  if (rows.length === 0) {
    console.error("FAIL: upsert produced no rows");
    process.exit(1);
  }

  // Run three queries. Each is intentionally written as a natural
  // question rather than keyword matching so we're measuring
  // semantic search and not BM25.
  const queries = [
    "what auth provider did we pick",
    "which database are we using",
    "should we pick next.js or tanstack start",
  ];

  for (const query of queries) {
    const hits = await searchProjectKnowledge({
      projectId: project.id,
      query,
      k: 3,
      minSimilarity: 0,
    });
    console.log(`\n? ${query}`);
    if (hits.length === 0) {
      console.error("  (no hits — something is wrong)");
      process.exit(1);
    }
    for (const hit of hits) {
      const preview = hit.content.replace(/\s+/g, " ").slice(0, 80);
      console.log(`  ${hit.similarity.toFixed(3)}  ${preview}…`);
    }
  }

  // Idempotency check: re-upserting the same chunks should produce
  // 0 embeds (all hashes match) and 0 orphans.
  const second = await upsertKnowledge({
    teamId: project.teamId,
    projectId: project.id,
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    title: "Smoke test note",
    chunks,
  });
  console.log("\nRe-upsert (should be all reused):", second);
  if (second.embedded !== 0) {
    console.error("FAIL: re-upsert re-embedded chunks unnecessarily");
    process.exit(1);
  }

  // Cleanup.
  await deleteKnowledgeForSource(SOURCE_TYPE, SOURCE_ID);
  const remaining = await db
    .select()
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.sourceType, SOURCE_TYPE),
        eq(projectKnowledge.sourceId, SOURCE_ID),
      ),
    );
  if (remaining.length > 0) {
    console.error("FAIL: cleanup left rows behind");
    process.exit(1);
  }

  console.log("\n✓ smoke test passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke test threw:", err);
  process.exit(1);
});
