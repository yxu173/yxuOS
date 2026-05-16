import { z } from "zod";

/**
 * Treat empty strings as `undefined` so optional vars in `.env.example`
 * don't fail validation when copied verbatim.
 */
const empty = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const envSchema = z.object({
  // ─── Core ───────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    empty,
    z.string().url().default("http://localhost:3000"),
  ),
  NEXT_PUBLIC_SHOW_DEV_TOOLBAR: z.preprocess(empty, z.string().optional()),

  // ─── Database (Neon Postgres + pgvector) ───────────────
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.preprocess(empty, z.string().optional()),

  // ─── Better Auth ───────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 chars (run `openssl rand -base64 32`)"),
  BETTER_AUTH_URL: z.preprocess(
    empty,
    z.string().url().default("http://localhost:3000"),
  ),
  GITHUB_CLIENT_ID: z.preprocess(empty, z.string().optional()),
  GITHUB_CLIENT_SECRET: z.preprocess(empty, z.string().optional()),
  GOOGLE_CLIENT_ID: z.preprocess(empty, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(empty, z.string().optional()),

  // ─── AI providers ──────────────────────────────────────
  AI_GATEWAY_API_KEY: z.preprocess(empty, z.string().optional()),
  OPENAI_API_KEY: z.preprocess(empty, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(empty, z.string().optional()),

  // Azure AI Foundry — Anthropic Messages-compatible endpoint.
  // Base URL like `https://<resource>.services.ai.azure.com/anthropic`.
  AZURE_ANTHROPIC_BASE_URL: z.preprocess(empty, z.string().url().optional()),
  AZURE_ANTHROPIC_API_KEY: z.preprocess(empty, z.string().optional()),
  AZURE_ANTHROPIC_MODEL: z.preprocess(
    empty,
    z.string().default("claude-opus-4-7-1"),
  ),

  // Azure AI Foundry — OpenAI-compatible embeddings endpoint. Used
  // by the project-brain RAG layer. Set all three to switch the
  // embedding provider from OpenAI direct to Azure; leave unset to
  // fall back to `OPENAI_API_KEY` (or disable embeddings entirely).
  //
  // Endpoint shape: `https://<resource>.services.ai.azure.com`
  // (the "services" Foundry endpoint, NOT the legacy
  // `<resource>.openai.azure.com`). The `/openai` suffix is added
  // automatically inside `embed.ts` to match the Azure provider's
  // `{baseURL}/v1{path}` convention.
  AZURE_EMBEDDINGS_ENDPOINT: z.preprocess(
    empty,
    z.string().url().optional(),
  ),
  AZURE_EMBEDDINGS_API_KEY: z.preprocess(empty, z.string().optional()),
  /** Deployment name in your Foundry resource. Typically matches the model id. */
  AZURE_EMBEDDINGS_DEPLOYMENT: z.preprocess(
    empty,
    z.string().default("text-embedding-3-large"),
  ),

  // ─── Mastra ────────────────────────────────────────────
  MASTRA_TELEMETRY_DISABLED: z.preprocess(empty, z.string().optional()),

  // ─── Researcher agent (Exa web search) ──────────────────────
  // Required for the Researcher agent's `web_search` tool. Without it,
  // the tool returns a graceful error and the agent falls back to
  // workspace-only research. Get one at https://exa.ai/.
  EXA_API_KEY: z.preprocess(empty, z.string().optional()),

  // ─── Vercel Blob (object storage for the design asset library) ─
  // Required to upload images via the Library tab. Without it,
  // `uploadDesignAsset` throws a clear error in the UI.
  // Get one at https://vercel.com/dashboard → Storage → Blob.
  BLOB_READ_WRITE_TOKEN: z.preprocess(empty, z.string().optional()),

  // ─── Integrations (Module 7) ───────────────────────────
  GITHUB_APP_ID: z.preprocess(empty, z.string().optional()),
  GITHUB_APP_PRIVATE_KEY: z.preprocess(empty, z.string().optional()),
  GITHUB_WEBHOOK_SECRET: z.preprocess(empty, z.string().optional()),
  FIGMA_ACCESS_TOKEN: z.preprocess(empty, z.string().optional()),
  SLACK_BOT_TOKEN: z.preprocess(empty, z.string().optional()),
  SLACK_SIGNING_SECRET: z.preprocess(empty, z.string().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("\u274c Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type Env = typeof env;
