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

  // ─── Mastra ────────────────────────────────────────────
  MASTRA_TELEMETRY_DISABLED: z.preprocess(empty, z.string().optional()),

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
