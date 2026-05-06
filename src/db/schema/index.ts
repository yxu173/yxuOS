/**
 * Aggregate every table / relation declared under `src/db/schema`.
 *
 * Add new module schemas (projects, tasks, documents, diagrams, canvas, …)
 * by creating a sibling file here and re-exporting from this barrel.
 */
export * from "./auth";
