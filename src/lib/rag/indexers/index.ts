/**
 * Per-artifact RAG indexer barrel.
 *
 * One re-export per artifact kind so the backfill script and the
 * brain UI can iterate over indexers without hard-coding the full
 * list each time. When you add a new indexer:
 *
 *   1. Add the kind to `KnowledgeKind` in
 *      `src/db/schema/project-knowledge.ts`.
 *   2. Create `src/lib/rag/indexers/<kind>.ts` exporting `index<X>`
 *      and `unindex<X>`.
 *   3. Re-export it here.
 *   4. Wire the artifact's server actions / agent tools to call
 *      `index<X>` / `unindex<X>` via `after(...)` from `next/server`.
 *
 * Step 4 is the only place where the call is awaited (well — fired
 * via `after`) at the artifact's write-path. Everything else here is
 * a thin re-export.
 */

export { indexBoard, unindexBoard } from "./board";
export { indexComment, unindexComment } from "./comment";
export { indexDesign, unindexDesign } from "./design";
export { indexResearchNote, unindexResearchNote } from "./research-note";
export { indexTask, unindexTask } from "./task";
export { indexTaskPlan, unindexTaskPlan } from "./task-plan";
export {
  buildRepoFileSourceId,
  indexRepoFile,
  parseRepoFileSourceId,
  unindexRepo,
} from "./repo-file";
export { markRepoPending, runRepoIndex } from "./repo";
