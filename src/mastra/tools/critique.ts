import { generateObject } from "ai";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { models } from "@/lib/ai";

import { toolResultSchema } from "./_envelope";

/**
 * Critique helper tool.
 *
 * Compose-and-critique is a classic quality bump: a strong model drafts, a
 * second model picks the draft apart, the first model patches what's
 * worth patching. The board and design agents run on opus and would
 * otherwise be marking their own homework. This tool gives them a cheap
 * second opinion by calling sonnet with a deliberately picky critic
 * prompt.
 *
 * The agent passes whatever it just produced — a JSON board summary, a
 * design tree, a markdown ADR — along with the user's original intent. We
 * return a structured list of issues so the agent can route each one to a
 * concrete fix tool (`update_shapes`, `patch_nodes`, …) instead of trying
 * to parse free-form prose.
 *
 * This is intentionally NOT a workflow: the agent owns when to call it
 * (after a big build, before declaring done) and what to do with the
 * results (apply / dismiss / ask the user). Wrapping it as a workflow
 * would lock in a sequence the canvas agents can't actually use, since
 * their fix tools are client-side and can't be invoked mid-workflow.
 */

const issueSchema = z.object({
  severity: z
    .enum(["error", "warning", "info"])
    .describe(
      "`error` = ship-blocker (broken contract, placeholder copy, overlap). `warning` = quality smell. `info` = nice-to-have.",
    ),
  title: z
    .string()
    .describe("≤ 10-word headline so the agent can grep the result list."),
  detail: z
    .string()
    .describe(
      "2-4 lines. What's wrong, why, and which tool ID would fix it. Be specific — name shape ids / node ids / token paths when possible.",
    ),
  targetIds: z
    .array(z.string())
    .optional()
    .describe(
      "Shape ids / node ids the issue applies to, when the agent can derive them from the artifact.",
    ),
  suggestedTool: z
    .string()
    .optional()
    .describe(
      "Concrete tool the critic recommends running, e.g. `update_shapes`, `patch_nodes`, `apply_theme`, `layout_shapes`.",
    ),
});

const inputSchema = z.object({
  artifactKind: z
    .enum(["board", "design", "markdown", "plan"])
    .describe(
      "What you're asking the critic to evaluate. Drives which design principles get applied.",
    ),
  artifact: z
    .string()
    .min(1)
    .max(40_000)
    .describe(
      "The artifact itself, serialized as a string. For boards, pass the JSON returned by `query_canvas` (or a relevant subset). For designs, the tree returned by `get_artboard`. For plans / markdown, the raw text.",
    ),
  userIntent: z
    .string()
    .min(1)
    .max(2_000)
    .describe(
      "One paragraph: what the user asked for. The critic uses this to judge whether the artifact actually solves the problem, not just whether it's pretty.",
    ),
  focus: z
    .array(z.string())
    .max(8)
    .optional()
    .describe(
      "Optional categories to prioritise — e.g. ['copy quality', 'a11y contrast', 'arrow routing']. Omit to let the critic pick.",
    ),
});

const outputData = z.object({
  summary: z
    .string()
    .describe(
      "One-sentence verdict the agent can paste into chat: e.g. 'Two ship-blockers and three smells; fix the placeholder copy first.'",
    ),
  issues: z.array(issueSchema),
});

const PROMPT_SUFFIX = `

You are a senior design / systems-architecture reviewer. Be specific and merciless: if the artifact has placeholder copy, name the exact node id. If two shapes overlap, name both. If a colour fails AA contrast, give the computed ratio. Do NOT compliment.

Prioritise issues that BLOCK SHIPPING (errors) over issues that are merely smelly (warnings). If the artifact is genuinely clean, return an empty issues list and say so in summary — don't invent problems.`;

export const critiqueTool = createTool({
  id: "critique_work",
  description:
    "Run a structured second-opinion critique on whatever you just built (board / design / markdown / plan). Calls a separate critic model (sonnet) and returns a sorted list of issues with severity, target ids, and suggested fix tools. Use this AFTER a big build and BEFORE telling the user it's done — pair with audit tools for the strongest quality bar.",
  inputSchema,
  outputSchema: toolResultSchema(outputData),
  execute: async (input) => {
    const focusLine = input.focus?.length
      ? `\nFocus categories: ${input.focus.join(", ")}.`
      : "";

    const prompt = `User intent:
${input.userIntent}
${focusLine}

Artifact (${input.artifactKind}):
${input.artifact}${PROMPT_SUFFIX}`;

    try {
      const { object } = await generateObject({
        model: models.sonnet,
        schema: outputData,
        prompt,
      });

      return {
        ok: true as const,
        data: object,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: {
          code: "internal" as const,
          message:
            err instanceof Error ? err.message : "critique_work failed",
          hint: "Retry once. If it fails again, skip the critique step and rely on analyze_canvas / audit_design alone.",
        },
      };
    }
  },
});
