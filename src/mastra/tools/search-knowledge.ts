import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  type KnowledgeKind,
  type ProjectKnowledgeRow,
} from "@/db/schema/project-knowledge";
import { isEmbeddingsEnabled } from "@/lib/rag/embed";
import { searchProjectKnowledge } from "@/lib/rag/retrieve";

import { toolResultSchema } from "./_envelope";

/**
 * Agent-facing tool: semantic search across the **project brain**.
 *
 * One tool, used by every agent (board, design, planner, researcher).
 * Reads `{ teamId, projectId }` from the `"project"` namespace on
 * the Mastra `requestContext` — every chat route attaches that
 * namespace, so this tool just works once it's added to the agent's
 * `tools` map.
 *
 * Permission contract is the same as the rest of the workspace
 * tools: the projectId comes from the server-known context, not
 * anything the agent emits. The agent literally cannot read another
 * project's memory.
 *
 * What it's for: when the user references something vaguely
 * ("the OIDC decision"), the agent searches the brain instead of
 * making things up. Hits come back as cited chunks with stable
 * source-type / source-id pointers that the agent can include in
 * its answer so the user can click through.
 *
 * Threshold note: the default minSimilarity is tighter than the
 * library's (0.3 vs 0.2) so marginal hits don't bait the model into
 * elaborating on noise. The `searchProjectKnowledge` helper drops
 * hits below the threshold before returning.
 */

/** Stable runtime context every cross-agent project tool can read. */
export interface ProjectToolContext {
  teamId: string;
  projectId: string;
}

function readProjectContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): ProjectToolContext {
  const requestContext = ctx?.requestContext;
  if (!requestContext || typeof requestContext.get !== "function") {
    throw new Error(
      "search_project_knowledge requires a `requestContext` on the Mastra invocation",
    );
  }
  const value = requestContext.get("project") as ProjectToolContext | null;
  if (!value || !value.teamId || !value.projectId) {
    throw new Error(
      "search_project_knowledge: `project` context is missing teamId / projectId",
    );
  }
  return value;
}

/* ─── schema ──────────────────────────────────────── */

// Mirror the `KnowledgeKind` union so the model can filter.
const KIND_VALUES: readonly KnowledgeKind[] = [
  "research_note",
  "task_plan",
  "task_plan_row",
  "task",
  "board",
  "design",
  "design_chat",
  "comment",
] as const;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Natural-language question, not keywords. e.g. 'what auth provider did we pick' rather than 'auth'.",
    ),
  kinds: z
    .array(z.enum(KIND_VALUES as unknown as [string, ...string[]]))
    .max(KIND_VALUES.length)
    .optional()
    .describe(
      "Restrict to specific artifact kinds. Omit to search everything in the project.",
    ),
  k: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Top-K hits. Default 6. Increase for breadth, decrease for focus."),
});

const hitSchema = z.object({
  sourceType: z.enum(KIND_VALUES as unknown as [string, ...string[]]),
  sourceId: z.string(),
  title: z.string().nullable(),
  anchor: z.string().nullable(),
  similarity: z.number(),
  // Capped excerpt so the agent's context window doesn't balloon.
  excerpt: z.string(),
  updatedAt: z.string(),
});

const outputData = z.object({
  hits: z.array(hitSchema),
  /** True when neither Azure nor OpenAI embeddings are configured. */
  embeddingsDisabled: z.boolean(),
});

/* ─── tool ────────────────────────────────────────── */

export const searchProjectKnowledgeTool = createTool({
  id: "search_project_knowledge",
  description:
    "Semantic search across this project's brain — research notes, task plans, tasks, boards, designs, comments. Use this before guessing or asking the user for context that might already be written down. Returns cited chunks; quote the relevant ones in your reply so the user can click through.",
  inputSchema,
  outputSchema: toolResultSchema(outputData),
  execute: async (input, ctxArg) => {
    const ctx = readProjectContext(ctxArg);

    // Tighter floor than the library default so weak hits don't
    // distract the model.
    const MIN_SIM = 0.3;

    const hits = await searchProjectKnowledge({
      projectId: ctx.projectId,
      query: input.query,
      k: input.k ?? 6,
      kinds: input.kinds as KnowledgeKind[] | undefined,
      minSimilarity: MIN_SIM,
    });

    return {
      ok: true as const,
      data: {
        hits: hits.map(formatHit),
        // The library returns [] when embeddings are off. We can't
        // distinguish that from "no matches" without an explicit
        // signal, so we surface it here for the agent to mention if
        // needed ("brain is empty / not configured").
        embeddingsDisabled: hits.length === 0 && needsConfigCheck(),
      },
    };
  },
});

/* ─── helpers ─────────────────────────────────────── */

function formatHit(hit: {
  sourceType: KnowledgeKind;
  sourceId: string;
  title: string | null;
  anchor: string | null;
  content: string;
  similarity: number;
  updatedAt: Date;
}): z.infer<typeof hitSchema> {
  return {
    sourceType: hit.sourceType,
    sourceId: hit.sourceId,
    title: hit.title,
    anchor: hit.anchor,
    similarity: Number(hit.similarity.toFixed(3)),
    excerpt: clipExcerpt(hit.content, 320),
    updatedAt: hit.updatedAt.toISOString(),
  };
}

function clipExcerpt(input: string, max: number): string {
  const flat = input.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Cheap probe: are embeddings configured? Goes through the shared
 * `isEmbeddingsEnabled` so Azure-only deployments (no
 * `OPENAI_API_KEY`) aren't misreported as disabled. The retrieve
 * helper returns `[]` when keys are missing or the query is empty;
 * we only flag "disabled" when the helper looks like it gave up
 * entirely.
 */
function needsConfigCheck(): boolean {
  return !isEmbeddingsEnabled();
}

// Re-export the row type for any code that wants to render hits.
export type { ProjectKnowledgeRow };
