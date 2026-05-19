import { createAzure } from "@ai-sdk/azure";

import { env } from "./env";

/**
 * Azure AI Foundry exposes OpenAI-compatible models at
 * `https://<resource>.services.ai.azure.com/openai/v1/...`.
 * We use `@ai-sdk/azure` with a custom `baseURL` — the provider
 * appends `/v1` automatically (as the default `apiVersion`) and
 * uses the standard `/v1/chat/completions` path.
 */
function buildAzureOpenAI() {
  if (!env.AZURE_OPENAI_BASE_URL || !env.AZURE_OPENAI_API_KEY) {
    throw new Error(
      "AZURE_OPENAI_BASE_URL and AZURE_OPENAI_API_KEY must be set in .env.local to use Azure OpenAI models.",
    );
  }

  return createAzure({
    baseURL: env.AZURE_OPENAI_BASE_URL + "/openai",
    apiKey: env.AZURE_OPENAI_API_KEY,
  });
}

let _azureOpenAI: ReturnType<typeof createAzure> | null = null;

function azureOpenAI() {
  if (!_azureOpenAI) {
    _azureOpenAI = buildAzureOpenAI();
  }
  return _azureOpenAI;
}

export const models = {
  get opus() {
    return azureOpenAI().chat(env.AZURE_OPENAI_MODEL);
  },
};
