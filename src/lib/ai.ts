import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";

import { env } from "./env";

/**
 * Amazon Bedrock provider for Anthropic Claude models.
 * We use `@ai-sdk/amazon-bedrock` with either long-term API keys
 * (apiKey + region) or standard AWS credentials
 * (accessKeyId + secretAccessKey + region).
 *
 * Claude Opus 4.6 is accessed via the cross-region inference profile
 * `us.anthropic.claude-opus-4-6-v1` (default) so it works across all
 * US regions without requiring in-region availability.
 */
function buildBedrock() {
  if (!env.BEDROCK_REGION) {
    throw new Error(
      "BEDROCK_REGION must be set in .env.local to use Amazon Bedrock models.",
    );
  }

  if (env.BEDROCK_API_KEY) {
    return createAmazonBedrock({
      region: env.BEDROCK_REGION,
      apiKey: env.BEDROCK_API_KEY,
    });
  }

  if (env.BEDROCK_ACCESS_KEY_ID && env.BEDROCK_SECRET_ACCESS_KEY) {
    return createAmazonBedrock({
      region: env.BEDROCK_REGION,
      accessKeyId: env.BEDROCK_ACCESS_KEY_ID,
      secretAccessKey: env.BEDROCK_SECRET_ACCESS_KEY,
    });
  }

  throw new Error(
    "BEDROCK_API_KEY or (BEDROCK_ACCESS_KEY_ID + BEDROCK_SECRET_ACCESS_KEY) must be set in .env.local to use Amazon Bedrock models.",
  );
}

let _bedrock: ReturnType<typeof createAmazonBedrock> | null = null;

function bedrock() {
  if (!_bedrock) {
    _bedrock = buildBedrock();
  }
  return _bedrock;
}

/**
 * Tiered model registry. Agents pick the cheapest model that can do
 * the job:
 *
 * - `opus`   — composition-heavy turns (drafting an architecture
 *              diagram, designing a whole landing page, writing a
 *              plan from scratch).
 * - `sonnet` — second opinions, audits, structured criticism, and
 *              re-reads after a big mutation (`analyze_canvas` /
 *              `audit_design` follow-ups).
 * - `haiku`  — single-tool turns: renames, colour swaps, "make this
 *              red", `set_selection` / `focus_camera` only.
 *
 * Each getter is lazy so we don't pay the Bedrock client construction
 * cost for tiers a given agent never uses.
 */
export const models = {
  get opus() {
    return bedrock().languageModel(env.BEDROCK_MODEL);
  },
  get sonnet() {
    return bedrock().languageModel(env.BEDROCK_MODEL_MID);
  },
  get haiku() {
    return bedrock().languageModel(env.BEDROCK_MODEL_FAST);
  },
};
