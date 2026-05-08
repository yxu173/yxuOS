import { createTool } from "@mastra/core/tools";
import Exa from "exa-js";
import { z } from "zod";

import { env } from "@/lib/env";

import { toolResultSchema } from "./_envelope";

/**
 * Lazy-singleton Exa client — instantiated on first use so importing
 * this module doesn't fail at boot when `EXA_API_KEY` is unset.
 * (Researcher agent is still useful with workspace-only context.)
 */
let _client: Exa | null = null;
function client(): Exa | null {
  if (_client) return _client;
  if (!env.EXA_API_KEY) return null;
  _client = new Exa(env.EXA_API_KEY);
  return _client;
}

/* ─── schema ─────────────────────────────────────── */

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "Natural-language search query. Phrase it as you would explain it to a knowledgeable colleague — Exa's neural ranking responds better to sentences than to keyword salads.",
    ),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(5)
    .describe(
      "How many top results to return. Default 5; cap is 8. Keep this small — every result fills your context window.",
    ),
  category: z
    .enum([
      "company",
      "research paper",
      "news",
      "pdf",
      "personal site",
      "financial report",
      "people",
    ])
    .optional()
    .describe(
      "Optional filter to bias results toward a kind of source (e.g. 'research paper' for academic, 'news' for current events).",
    ),
  startPublishedDate: z
    .string()
    .optional()
    .describe(
      "Optional ISO date (YYYY-MM-DD). Only results published on or after this date are returned.",
    ),
});

const resultSchema = z.object({
  title: z.string().nullable(),
  url: z.string(),
  publishedDate: z.string().optional(),
  author: z.string().optional(),
  /** Concise model-friendly summary of the page contents. */
  summary: z.string().optional(),
  /** Verbatim snippet excerpt (≤ ~1 KB). */
  text: z.string().optional(),
});

const dataSchema = z.object({
  query: z.string(),
  results: z.array(resultSchema),
});

/* ─── tool ───────────────────────────────────────── */

/**
 * `web_search` — neural web search via Exa.
 *
 * The agent should reach for this only when in-workspace context
 * (boards, tasks, prior notes) genuinely doesn't answer the question.
 * Citations are mandatory: every claim sourced from an Exa result
 * must carry the URL inline so the user can verify it.
 *
 * Budget guards (per agent turn):
 *   - This tool's input caps `numResults` at 8.
 *   - The system prompt asks the agent to stop after ~3 calls per turn.
 *   - Each result returns BOTH a summary AND a 1 KB text excerpt; the
 *     agent picks whichever it needs and discards the rest.
 */
export const exaSearchTool = createTool({
  id: "web_search",
  description:
    "Search the public web via Exa's neural index. Returns top results with title, URL, and a concise summary + text excerpt for each. Use to ground claims that aren't covered by the workspace's own boards/tasks/notes. Always cite the URL of any fact you lift into your reply or note body.",
  inputSchema,
  outputSchema: toolResultSchema(dataSchema),
  execute: async (input) => {
    const exa = client();
    if (!exa) {
      return {
        ok: false as const,
        error: {
          code: "canvas_unavailable" as const,
          message: "Web search is unavailable (EXA_API_KEY is not set).",
          hint: "Fall back to in-workspace context or report the limitation to the user.",
        },
      };
    }

    try {
      const response = await exa.searchAndContents(input.query, {
        numResults: input.numResults,
        // Both `summary` and `text` are useful at different turns —
        // summary for "tell me what this is about", text for "lift
        // this exact phrase". Keep the text excerpt short.
        summary: true,
        text: { maxCharacters: 1000 },
        ...(input.category ? { category: input.category } : {}),
        ...(input.startPublishedDate
          ? { startPublishedDate: input.startPublishedDate }
          : {}),
      });

      const results = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        ...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
        ...(r.author ? { author: r.author } : {}),
        ...(typeof r.summary === "string" ? { summary: r.summary } : {}),
        ...(typeof r.text === "string" ? { text: r.text } : {}),
      }));

      return {
        ok: true as const,
        data: {
          query: input.query,
          results,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Web search failed.";
      return {
        ok: false as const,
        error: {
          code: "internal" as const,
          message,
          hint: "Retry once with a tighter query, or fall back to in-workspace context.",
        },
      };
    }
  },
});
