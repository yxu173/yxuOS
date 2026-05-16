import { eq } from "drizzle-orm";

import { db } from "@/db";
import { tasks } from "@/db/schema";

import { chunkMarkdown } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **tasks**.
 *
 * Tasks store their description as TipTap-emitted HTML in the
 * `description` column. We strip tags + collapse whitespace to a
 * plain-text body, prepend the title as an H1, then chunk via
 * `chunkMarkdown`. Status / priority / assignee surface as a meta
 * line so a query like "what tasks are blocking the launch" can
 * land on the relevant rows.
 *
 * Completed (`status = done`) tasks stay in the brain on purpose —
 * "how did we solve X last quarter" is exactly the kind of
 * project memory the brain is for. Only deletion removes a task's
 * chunks (or an explicit "archived"-style status, which we don't
 * have yet for tasks).
 */
export async function indexTask(taskId: string): Promise<void> {
  try {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: {
        id: true,
        teamId: true,
        projectId: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        assigneeId: true,
        dueDate: true,
        parentTaskId: true,
      },
    });

    if (!task) {
      await deleteKnowledgeForSource("task", taskId);
      return;
    }
    if (!task.projectId) {
      // Project-less task — brain is project-scoped, so drop
      // any stale chunks and bail.
      await deleteKnowledgeForSource("task", taskId);
      return;
    }

    const title = task.title?.trim() ?? "";
    const body = htmlToPlain(task.description ?? "");

    if (title.length === 0 && body.length === 0) {
      await deleteKnowledgeForSource("task", taskId);
      return;
    }

    const metaLine = [
      `status=${task.status}`,
      `priority=${task.priority}`,
      task.dueDate ? `due=${task.dueDate.toISOString().slice(0, 10)}` : null,
      task.assigneeId ? `assigned` : null,
      task.parentTaskId ? `subtask` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const composed = [
      `# ${title || "Untitled task"}`,
      metaLine,
      "",
      body,
    ].join("\n");

    const chunks = chunkMarkdown(composed);

    await upsertKnowledge({
      teamId: task.teamId,
      // Narrowed by the guard above.
      projectId: task.projectId,
      sourceType: "task",
      sourceId: taskId,
      title: task.title,
      metadata: {
        status: task.status,
        priority: task.priority,
        parentTaskId: task.parentTaskId,
      },
      chunks,
    });
  } catch (err) {
    console.error(
      `[rag/task] indexTask(${taskId}) failed:`,
      formatRagError(err),
    );
  }
}

export async function unindexTask(taskId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("task", taskId);
  } catch (err) {
    console.error(
      `[rag/task] unindexTask(${taskId}) failed:`,
      formatRagError(err),
    );
  }
}

/**
 * Tag-strip + whitespace-collapse. The TipTap output is well-formed
 * HTML but we never trust the tag soup; the embedding model only
 * cares about the textual content.
 */
function htmlToPlain(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
