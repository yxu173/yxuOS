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

  // Amazon Bedrock — chat model provider (Claude Opus 4.6).
  // Supports two auth methods:
  //   1. Long-term API key: BEDROCK_API_KEY + BEDROCK_REGION
  //   2. AWS credentials: BEDROCK_ACCESS_KEY_ID + BEDROCK_SECRET_ACCESS_KEY + BEDROCK_REGION
  // Get a key at https://console.aws.amazon.com/bedrock/home#/api-keys
  BEDROCK_REGION: z.preprocess(
    empty,
    z.string().default("us-east-1"),
  ),
  BEDROCK_MODEL: z.preprocess(
    empty,
    z.string().default("us.anthropic.claude-opus-4-6-v1"),
  ),
  // Mid-tier and fast-tier model ids on Bedrock. Used by agents that
  // want to spend less context / latency on cheap turns (renames,
  // colour swaps, audits) while keeping `BEDROCK_MODEL` (opus) for
  // composition-heavy turns. Override per environment if Anthropic
  // ships new ids; defaults track the latest cross-region inference
  // profiles available in US regions.
  BEDROCK_MODEL_MID: z.preprocess(
    empty,
    z.string().default("us.anthropic.claude-sonnet-4-6-v1"),
  ),
  BEDROCK_MODEL_FAST: z.preprocess(
    empty,
    z.string().default("us.anthropic.claude-haiku-4-6-v1"),
  ),
  BEDROCK_API_KEY: z.preprocess(empty, z.string().optional()),
  BEDROCK_ACCESS_KEY_ID: z.preprocess(empty, z.string().optional()),
  BEDROCK_SECRET_ACCESS_KEY: z.preprocess(empty, z.string().optional()),

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

  // ─── Cache (Upstash Redis REST) ────────────────────────
  // When both are set the app caches expensive read paths
  // (permissions, project listings, etc.) in Upstash. Leave
  // unset to fall back to the per-request React `cache()` only.
  // Get values at https://console.upstash.com/redis → your DB
  // → "REST API" panel.
  UPSTASH_REDIS_REST_URL: z.preprocess(empty, z.string().url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(empty, z.string().optional()),
  /**
   * Namespace prepended to every Redis key. Defaults to `y` (yxuOS).
   * Set per-environment (e.g. `y-prod`, `y-staging`) so multiple
   * deployments can share one Upstash database without colliding.
   */
  CACHE_NAMESPACE: z.preprocess(empty, z.string().default("y")),

  // ─── Integrations (Module 7) ───────────────────────────
  GITHUB_APP_ID: z.preprocess(empty, z.string().optional()),
  GITHUB_APP_CLIENT_ID: z.preprocess(empty, z.string().optional()),
  GITHUB_APP_CLIENT_SECRET: z.preprocess(empty, z.string().optional()),
  // PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`) or PKCS#8 PEM. For
  // local dev paste the multi-line PEM in double quotes. For Vercel
  // (which strips newlines in its dashboard UI) prefer the base64
  // variant below — the loader falls back to it automatically.
  GITHUB_APP_PRIVATE_KEY: z.preprocess(empty, z.string().optional()),
  GITHUB_APP_PRIVATE_KEY_B64: z.preprocess(empty, z.string().optional()),
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
