/**
 * RAG backfill — walk every artifact in every project (or one
 * project) and call its indexer so the brain populates with
 * existing content.
 *
 * Usage:
 *   bun scripts/rag-backfill.ts                  # all teams, all projects
 *   bun scripts/rag-backfill.ts <projectId>      # one project
 *   bun scripts/rag-backfill.ts --kind=task      # restrict to one artifact kind
 *
 * Idempotent. The chunk-hash-dedupe in `upsertKnowledge` means
 * re-running is cheap: only changed chunks get re-embedded.
 *
 * Exits 0 on success, 1 on failure. Prints per-kind progress with
 * counts so a long run is debuggable.
 */
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import {
  boards,
  comments,
  designs,
  projects,
  researchNotes,
  taskPlans,
  tasks,
} from "../src/db/schema";
import type { KnowledgeKind } from "../src/db/schema/project-knowledge";
import {
  embedQuery,
  getEmbeddingProviderKind,
  getEmbedModelId,
  isEmbeddingsEnabled,
} from "../src/lib/rag/embed";
import { formatRagError } from "../src/lib/rag/log";
import {
  indexBoard,
  indexComment,
  indexDesign,
  indexResearchNote,
  indexTask,
  indexTaskPlan,
} from "../src/lib/rag/indexers";

type AnyKind = KnowledgeKind | "all";

async function main() {
  if (!isEmbeddingsEnabled()) {
    console.error(
      "No embedding provider configured — backfill needs embeddings.\n" +
        "Set either the Azure pair AZURE_EMBEDDINGS_ENDPOINT +\n" +
        "AZURE_EMBEDDINGS_API_KEY (recommended) or OPENAI_API_KEY.",
    );
    process.exit(1);
  }

  // Sanity-check the provider with a single embed call before we
  // walk thousands of artifacts. If the key/endpoint is wrong, we
  // want one clean error line, not one error line per indexer call.
  // The indexers swallow their own errors by design, so without
  // this preflight a broken provider produces a stack-trace flood.
  console.log(`provider: ${getEmbeddingProviderKind()} (${getEmbedModelId()})`);
  try {
    const probe = await embedQuery("backfill preflight probe");
    if (!probe) {
      console.error("Preflight returned null — provider not actually wired.");
      process.exit(1);
    }
  } catch (err) {
    console.error(
      "Preflight embed call failed. Fix the provider before backfilling.\n\n" +
        "  " +
        formatRagError(err),
    );
    process.exit(1);
  }

  // Trivial CLI parser. We don't need yargs for two flags.
  const args = process.argv.slice(2);
  let projectId: string | null = null;
  let kindFilter: AnyKind = "all";
  for (const arg of args) {
    if (arg.startsWith("--kind=")) {
      kindFilter = arg.slice("--kind=".length) as AnyKind;
      continue;
    }
    if (!arg.startsWith("-")) {
      projectId = arg;
    }
  }

  console.log(`--- RAG backfill ---`);
  console.log(`project: ${projectId ?? "(all)"}`);
  console.log(`kind:    ${kindFilter}`);

  const projectIds = await pickProjectIds(projectId);
  if (projectIds.length === 0) {
    console.error("No projects to backfill.");
    process.exit(0);
  }
  console.log(`scanning ${projectIds.length} project(s)\n`);

  let total = 0;
  for (const pid of projectIds) {
    console.log(`▸ project ${pid}`);
    total += await backfillProject(pid, kindFilter);
  }
  console.log(`\n✓ backfill complete — ${total} artifact(s) indexed`);
  process.exit(0);
}

/* ─── project picker ────────────────────────────── */

async function pickProjectIds(only: string | null): Promise<string[]> {
  if (only) {
    const row = await db.query.projects.findFirst({
      where: eq(projects.id, only),
      columns: { id: true },
    });
    return row ? [row.id] : [];
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects);
  return rows.map((r) => r.id);
}

/* ─── per-project walker ────────────────────────── */

async function backfillProject(
  projectId: string,
  kindFilter: AnyKind,
): Promise<number> {
  let count = 0;

  if (shouldRun("research_note", kindFilter)) {
    count += await walkKind(
      "research_note",
      () =>
        db
          .select({ id: researchNotes.id })
          .from(researchNotes)
          .where(eq(researchNotes.projectId, projectId)),
      (id) => indexResearchNote(id),
    );
  }

  if (shouldRun("task_plan", kindFilter)) {
    count += await walkKind(
      "task_plan",
      () =>
        db
          .select({ id: taskPlans.id })
          .from(taskPlans)
          .where(eq(taskPlans.projectId, projectId)),
      (id) => indexTaskPlan(id),
    );
  }

  if (shouldRun("task", kindFilter)) {
    count += await walkKind(
      "task",
      () =>
        db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.projectId, projectId)),
      (id) => indexTask(id),
    );
  }

  if (shouldRun("board", kindFilter)) {
    count += await walkKind(
      "board",
      () =>
        db
          .select({ id: boards.id })
          .from(boards)
          .where(eq(boards.projectId, projectId)),
      (id) => indexBoard(id),
    );
  }

  if (shouldRun("design", kindFilter)) {
    count += await walkKind(
      "design",
      () =>
        db
          .select({ id: designs.id })
          .from(designs)
          .where(eq(designs.projectId, projectId)),
      (id) => indexDesign(id),
    );
  }

  if (shouldRun("comment", kindFilter)) {
    // Comments don't carry projectId; the indexer resolves it via
    // the parent subject. We over-scan a little: pull every comment
    // on the team's boards/designs/tasks in this project, then let
    // the indexer's own self-heal handle anything we mis-routed.
    count += await walkKind(
      "comment",
      async () => {
        const rows = await db.select({ id: comments.id }).from(comments);
        // No projectId filter — indexer drops out cleanly for
        // anything not in this project. Small over-scan in exchange
        // for not having to plumb projectId through the schema.
        return rows;
      },
      (id) => indexComment(id),
    );
  }

  return count;
}

/* ─── helpers ───────────────────────────────────── */

function shouldRun(kind: KnowledgeKind, filter: AnyKind): boolean {
  return filter === "all" || filter === kind;
}

/**
 * Run an indexer over a list of ids serially. We deliberately don't
 * parallelise: the upsert path itself batches embed calls inside,
 * and serial execution keeps OpenAI rate-limit pressure bounded.
 * For a project with 10k artifacts this still finishes in minutes.
 */
async function walkKind(
  label: string,
  fetchIds: () => Promise<{ id: string }[]> | { id: string }[],
  index: (id: string) => Promise<void>,
): Promise<number> {
  const ids = await fetchIds();
  if (ids.length === 0) {
    console.log(`  ${label}: 0`);
    return 0;
  }
  let done = 0;
  for (const { id } of ids) {
    await index(id);
    done += 1;
    if (done % 25 === 0) {
      // Progress ping for long runs.
      process.stdout.write(
        `\r  ${label}: ${done}/${ids.length}`,
      );
    }
  }
  console.log(`\r  ${label}: ${done}/${ids.length}`);
  return done;
}

main().catch((err) => {
  console.error("backfill threw:", err);
  process.exit(1);
});
