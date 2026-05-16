import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { taskPlanRows, taskPlans } from "@/db/schema";

import { approxTokens, type Chunk } from "../chunk";
import { formatRagError } from "../log";
import { deleteKnowledgeForSource, upsertKnowledge } from "../upsert";

/**
 * Per-artifact RAG indexer for **task plans**.
 *
 * One plan = one artifact in the brain (`source_type = "task_plan"`).
 * Chunk shape:
 *
 *   - Chunk 0: plan title + optional source-note link line.
 *     anchor = null.
 *   - Chunk 1..N: one chunk per `task_plan_row`, anchor = row.id.
 *     Carries title, description, status, priority, due date,
 *     and the "(executed)" marker if the row already produced a
 *     real task. The row title is repeated as an H3 inside the
 *     chunk so its words show up in the embedding even though
 *     `chunkMarkdown` isn't doing the chunking for us.
 *
 * Why one chunk per row instead of running everything through
 * `chunkMarkdown`:
 *
 *   - Anchors. A retrieval hit pointing into a plan should land
 *     on the precise row, not the whole document — `hrefForHit`
 *     can scroll to `anchor = row.id` later.
 *   - Predictable shape for the eventual brain UI ("show me every
 *     planner row that mentions auth").
 *   - Plan rows are short (title <= 200 + description <= 4000),
 *     comfortably under the 800-token soft cap. No splitting
 *     needed.
 *
 * Archived plans are pulled out of the brain (same self-heal
 * branch as research notes). Empty plans (no rows, default title)
 * are unindexed entirely.
 */
export async function indexTaskPlan(planId: string): Promise<void> {
  try {
    const plan = await db.query.taskPlans.findFirst({
      where: eq(taskPlans.id, planId),
      columns: {
        id: true,
        teamId: true,
        projectId: true,
        title: true,
        status: true,
        sourceNoteId: true,
      },
    });

    if (!plan) {
      await deleteKnowledgeForSource("task_plan", planId);
      return;
    }
    if (plan.status === "archived") {
      await deleteKnowledgeForSource("task_plan", planId);
      return;
    }

    const rows = await db
      .select()
      .from(taskPlanRows)
      .where(eq(taskPlanRows.planId, planId))
      .orderBy(asc(taskPlanRows.position));

    const titleText = plan.title?.trim() || "Untitled plan";
    const headerLines = [`# ${titleText}`];
    if (plan.sourceNoteId) {
      headerLines.push(`derived from research note: ${plan.sourceNoteId}`);
    }
    headerLines.push(`status: ${plan.status}`);
    headerLines.push(`rows: ${rows.length}`);
    const titleChunk: Chunk = {
      content: headerLines.join("\n"),
      tokens: approxTokens(headerLines.join("\n")),
    };

    // Empty plan with only the default title — keep one title chunk
    // so the launcher can still surface it, but nothing else.
    if (rows.length === 0 && plan.title === "Untitled plan") {
      await deleteKnowledgeForSource("task_plan", planId);
      return;
    }

    const rowChunks: Chunk[] = [];
    for (const row of rows) {
      const lines: string[] = [`### ${row.title}`];
      const meta: string[] = [];
      meta.push(`status=${row.status}`);
      meta.push(`priority=${row.priority}`);
      if (row.dueDate) meta.push(`due=${row.dueDate.toISOString().slice(0, 10)}`);
      if (row.approvedAt) meta.push("approved");
      if (row.createdTaskId) meta.push(`materialised=${row.createdTaskId}`);
      lines.push(meta.join(" · "));
      if (row.description && row.description.trim().length > 0) {
        lines.push("");
        lines.push(row.description.trim());
      }
      const content = lines.join("\n");
      rowChunks.push({
        content,
        tokens: approxTokens(content),
        anchor: row.id,
      });
    }

    await upsertKnowledge({
      teamId: plan.teamId,
      projectId: plan.projectId,
      sourceType: "task_plan",
      sourceId: planId,
      title: titleText,
      metadata: {
        status: plan.status,
        rowCount: rows.length,
        sourceNoteId: plan.sourceNoteId,
      },
      chunks: [titleChunk, ...rowChunks],
    });
  } catch (err) {
    console.error(
      `[rag/task-plan] indexTaskPlan(${planId}) failed:`,
      formatRagError(err),
    );
  }
}

export async function unindexTaskPlan(planId: string): Promise<void> {
  try {
    await deleteKnowledgeForSource("task_plan", planId);
  } catch (err) {
    console.error(
      `[rag/task-plan] unindexTaskPlan(${planId}) failed:`,
      formatRagError(err),
    );
  }
}
