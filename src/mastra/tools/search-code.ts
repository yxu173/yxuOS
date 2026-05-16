import { and, eq } from "drizzle-orm";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { db } from "@/db";
import { projectRepos } from "@/db/schema";
import { parseRepoFileSourceId } from "@/lib/rag/indexers/repo-file";
import { searchProjectKnowledge } from "@/lib/rag/retrieve";
import { GitHubFetchError } from "@/lib/repos/github";

import { toolResultSchema } from "./_envelope";
import type { ProjectToolContext } from "./search-knowledge";

/**
 * Agent-facing tools for the **code** corner of the project brain.
 *
 * Two tools:
 *
 * - `search_code` — semantic search restricted to repo files.
 *   Returns cited chunks with `repoId`, `path`, and `startLine`/
 *   `endLine` so the agent can quote precisely.
 *
 * - `read_file` — pull the full contents of a specific file at
 *   the indexed SHA. The agent uses this after `search_code` lands
 *   a hit and it needs more context than the snippet provides
 *   (e.g. "show me the whole function"). Hits GitHub's
 *   `contents` endpoint live, so the response is always up-to-date
 *   with the indexed SHA, never with HEAD.
 *
 * Both tools read `{teamId, projectId}` from the project request
 * context — the agent can't cross-project, can't impersonate.
 */

function readProjectContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): ProjectToolContext {
  const requestContext = ctx?.requestContext;
  if (!requestContext || typeof requestContext.get !== "function") {
    throw new Error("search_code requires a `requestContext`");
  }
  const value = requestContext.get("project") as ProjectToolContext | null;
  if (!value || !value.teamId || !value.projectId) {
    throw new Error("search_code: missing project context");
  }
  return value;
}

/* ─── search_code ─────────────────────────────────────── */

const searchHitSchema = z.object({
  repoId: z.string(),
  repoSlug: z
    .string()
    .describe("`owner/repo@branch` for display / citation."),
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  similarity: z.number(),
  /**
   * Trimmed snippet — the full chunk wrapped in code fences, with
   * the language tag the chunker added at index time.
   */
  snippet: z.string(),
});

const searchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Natural-language question or feature name. e.g. 'where do we verify JWT tokens' or 'cache invalidation on save'. Better than keywords.",
    ),
  repoId: z
    .string()
    .optional()
    .describe(
      "Restrict to one imported repo. Omit to search every repo imported into this project's brain.",
    ),
  pathPrefix: z
    .string()
    .optional()
    .describe(
      "Restrict to files whose path starts with this string. Useful to focus on a subdirectory ('apps/api/').",
    ),
  k: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Top-K hits. Default 6."),
});

const searchOutput = z.object({
  hits: z.array(searchHitSchema),
  /** True when no repos have been imported into the project yet. */
  noReposImported: z.boolean(),
});

export const searchCodeTool = createTool({
  id: "search_code",
  description:
    "Semantic search across the code in repositories the team has imported into this project's brain. Returns cited code snippets with file path + line range. Use this whenever the user references implementation ('how does login work', 'where do we hash passwords', 'find the cache layer'). Cite the path and line range in your reply so the user can click through.",
  inputSchema: searchInputSchema,
  outputSchema: toolResultSchema(searchOutput),
  execute: async (input, ctxArg) => {
    const ctx = readProjectContext(ctxArg);

    // Short-circuit: if no repos imported, give the agent a clean
    // signal to tell the user "import a repo first".
    const anyRepo = await db.query.projectRepos.findFirst({
      where: eq(projectRepos.projectId, ctx.projectId),
      columns: { id: true },
    });
    if (!anyRepo) {
      return {
        ok: true as const,
        data: { hits: [], noReposImported: true },
      };
    }

    // Run a slightly wider search than `k` if we're going to
    // post-filter (repoId / pathPrefix) so the agent doesn't get
    // an under-filled result list when the top global hits don't
    // match the filter.
    const willFilter = Boolean(input.repoId || input.pathPrefix);
    const fetchK = willFilter ? Math.max((input.k ?? 6) * 4, 16) : input.k ?? 6;

    const hits = await searchProjectKnowledge({
      projectId: ctx.projectId,
      query: input.query,
      k: fetchK,
      kinds: ["repo_file"],
      minSimilarity: 0.25, // slightly looser than prose — code chunks
      // carry less natural-language signal so we accept a bit more
      // tail to compensate.
    });

    // Decorate with repo slug + parse the (repoId, path) out of
    // the sourceId.
    const repoCache = new Map<string, { slug: string }>();
    const decorated: z.infer<typeof searchHitSchema>[] = [];
    for (const hit of hits) {
      const parsed = parseRepoFileSourceId(hit.sourceId);
      if (!parsed) continue;
      if (input.repoId && parsed.repoId !== input.repoId) continue;
      if (input.pathPrefix && !parsed.path.startsWith(input.pathPrefix)) continue;

      let repoMeta = repoCache.get(parsed.repoId);
      if (!repoMeta) {
        const row = await db.query.projectRepos.findFirst({
          where: and(
            eq(projectRepos.id, parsed.repoId),
            eq(projectRepos.projectId, ctx.projectId),
          ),
          columns: { owner: true, repo: true, branch: true },
        });
        if (!row) continue;
        repoMeta = { slug: `${row.owner}/${row.repo}@${row.branch}` };
        repoCache.set(parsed.repoId, repoMeta);
      }

      // Extract line range from the anchor (`L<start>-L<end>`).
      const m = /^L(\d+)-L(\d+)$/.exec(hit.anchor ?? "");
      const startLine = m ? Number(m[1]) : 1;
      const endLine = m ? Number(m[2]) : startLine;

      decorated.push({
        repoId: parsed.repoId,
        repoSlug: repoMeta.slug,
        path: parsed.path,
        startLine,
        endLine,
        similarity: Number(hit.similarity.toFixed(3)),
        snippet: hit.content,
      });
      if (decorated.length >= (input.k ?? 6)) break;
    }

    return {
      ok: true as const,
      data: { hits: decorated, noReposImported: false },
    };
  },
});

/* ─── read_file ───────────────────────────────────────── */

const readInputSchema = z.object({
  repoId: z.string().describe("Repo id from a `search_code` hit."),
  path: z.string().describe("File path within the repo (no leading slash)."),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based start line. Omit to read from the top."),
  endLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based end line (inclusive). Omit to read to the end, but the return is capped at 600 lines per call to protect the context budget.",
    ),
});

const readOutput = z.object({
  path: z.string(),
  /** `owner/repo@branch` for citation. */
  repoSlug: z.string(),
  /** Trimmed file content covering the requested range, code-fenced. */
  content: z.string(),
  totalLines: z.number(),
  startLine: z.number(),
  endLine: z.number(),
  truncated: z.boolean(),
});

const MAX_READ_LINES = 600;
const GH_API = "https://api.github.com";

export const readFileTool = createTool({
  id: "read_file",
  description:
    "Read a specific file (or line range) from an imported repo. Use after `search_code` lands a hit and you need more context than the snippet provides. The file is fetched at the indexed SHA, so it stays consistent with what `search_code` returned. Capped at 600 lines per call.",
  inputSchema: readInputSchema,
  outputSchema: toolResultSchema(readOutput),
  execute: async (input, ctxArg) => {
    const ctx = readProjectContext(ctxArg);

    const repo = await db.query.projectRepos.findFirst({
      where: and(
        eq(projectRepos.id, input.repoId),
        eq(projectRepos.projectId, ctx.projectId),
      ),
    });
    if (!repo) {
      return {
        ok: false as const,
        error: {
          code: "not_found" as const,
          message: `Repo ${input.repoId} not found in this project.`,
        },
      };
    }
    const sha = repo.lastIndexedSha ?? repo.branch;

    try {
      const url = `${GH_API}/repos/${repo.owner}/${repo.repo}/contents/${input.path}?ref=${encodeURIComponent(sha)}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw",
        "User-Agent": "yxuOS-brain-reader",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (repo.accessToken) headers.Authorization = `Bearer ${repo.accessToken}`;
      const res = await fetch(url, { headers });
      if (res.status === 404) {
        return {
          ok: false as const,
          error: {
            code: "not_found" as const,
            message: `File ${input.path} not found in ${repo.owner}/${repo.repo}@${sha.slice(0, 7)}.`,
          },
        };
      }
      if (!res.ok) {
        throw new GitHubFetchError(
          `GitHub returned ${res.status}`,
          res.status,
          "unknown",
        );
      }
      const raw = await res.text();
      const allLines = raw.split("\n");
      const total = allLines.length;
      const startLine = Math.max(1, input.startLine ?? 1);
      // Cap the slice. If the caller specified a huge endLine, we
      // clip to MAX_READ_LINES — surfaced via `truncated`.
      const requestedEnd = input.endLine ?? total;
      const cappedEnd = Math.min(
        total,
        Math.min(requestedEnd, startLine + MAX_READ_LINES - 1),
      );
      const sliced = allLines.slice(startLine - 1, cappedEnd).join("\n");
      const truncated = cappedEnd < requestedEnd || cappedEnd < total && input.endLine === undefined;

      const ext = input.path.includes(".")
        ? input.path.slice(input.path.lastIndexOf(".") + 1)
        : "";
      const fenced = `\`\`\`${ext}\n// ${input.path} (L${startLine}-L${cappedEnd} of L${total})\n${sliced}\n\`\`\``;

      return {
        ok: true as const,
        data: {
          path: input.path,
          repoSlug: `${repo.owner}/${repo.repo}@${repo.branch}`,
          content: fenced,
          totalLines: total,
          startLine,
          endLine: cappedEnd,
          truncated,
        },
      };
    } catch (err) {
      const msg =
        err instanceof GitHubFetchError ? err.message : (err as Error).message;
      return {
        ok: false as const,
        error: { code: "internal" as const, message: msg },
      };
    }
  },
});
