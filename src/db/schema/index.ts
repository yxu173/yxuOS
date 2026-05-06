/**
 * Aggregate every table / relation declared under `src/db/schema`.
 *
 * Add new module schemas (tasks, documents, diagrams, …) by creating a
 * sibling file here and re-exporting from this barrel — and add their
 * relations to `relations.ts`.
 */
export * from "./auth";
export * from "./boards";
export * from "./relations";
