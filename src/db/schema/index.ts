/**
 * Aggregate every table / relation declared under `src/db/schema`.
 *
 * Add new module schemas (tasks, documents, diagrams, …) by creating a
 * sibling file here and re-exporting from this barrel — and add their
 * relations to `relations.ts`.
 */
export * from "./activity-log";
export * from "./attachments";
export * from "./auth";
export * from "./board-folders";
export * from "./board-versions";
export * from "./boards";
export * from "./comments";
export * from "./design-assets";
export * from "./design-components";
export * from "./design-folders";
export * from "./designs";
export * from "./project-knowledge";
export * from "./project-repos";
export * from "./projects";
export * from "./research-notes";
export * from "./task-boards";
export * from "./task-plans";
export * from "./tasks";
export * from "./team-design-tokens";
export * from "./relations";
