import { createAnthropic } from "@ai-sdk/anthropic";

import { env } from "./env";

/**
 * Azure AI Foundry exposes Anthropic models behind the standard
 * Anthropic Messages API (`/v1/messages`). We re-use `@ai-sdk/anthropic`
 * with a custom `baseURL` and pass the Azure subscription key as both
 * `x-api-key` (Anthropic-style) and `api-key` (Azure-style) so we don't
 * care which header the gateway honors.
 */
function buildAzureAnthropic() {
  if (!env.AZURE_ANTHROPIC_BASE_URL || !env.AZURE_ANTHROPIC_API_KEY) {
    throw new Error(
      "AZURE_ANTHROPIC_BASE_URL and AZURE_ANTHROPIC_API_KEY must be set in .env.local to use the Azure Anthropic provider.",
    );
  }

  return createAnthropic({
    baseURL: env.AZURE_ANTHROPIC_BASE_URL,
    apiKey: env.AZURE_ANTHROPIC_API_KEY,
    headers: {
      "api-key": env.AZURE_ANTHROPIC_API_KEY,
    },
  });
}

/**
 * Lazy-singleton — created on first access so simply importing this
 * module from a route that doesn't actually call the model won't throw
 * at boot time when env vars are missing.
 */
let _azureAnthropic: ReturnType<typeof createAnthropic> | null = null;

function azureAnthropic() {
  if (!_azureAnthropic) {
    _azureAnthropic = buildAzureAnthropic();
  }
  return _azureAnthropic;
}

/**
 * Models registry. Extend this when we wire additional providers
 * (Vercel AI Gateway, OpenAI, etc.) so call sites stay stable.
 */
export const models = {
  /**
   * Claude Opus 4.7 via Azure AI Foundry — the default reasoning model
   * used by the board agent.
   */
  get opus() {
    return azureAnthropic()(env.AZURE_ANTHROPIC_MODEL);
  },
};
