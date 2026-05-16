/**
 * Tiny sanity check for the embedding provider — no DB writes.
 * Verifies that whichever provider is configured (Azure or OpenAI)
 * actually returns the expected 1536-dim vectors.
 *
 *   bun scripts/embed-smoke.ts
 */
import {
  embedQuery,
  EMBED_DIMENSIONS,
  getEmbeddingProviderKind,
  getEmbedModelId,
  isEmbeddingsEnabled,
} from "../src/lib/rag/embed";

async function main() {
  console.log("provider :", getEmbeddingProviderKind());
  console.log("model    :", getEmbedModelId());
  console.log("enabled  :", isEmbeddingsEnabled());

  if (!isEmbeddingsEnabled()) {
    console.error(
      "No embedding provider configured. Set AZURE_EMBEDDINGS_* or OPENAI_API_KEY.",
    );
    process.exit(1);
  }

  const vec = await embedQuery("hello world from the project brain");
  if (!vec) {
    console.error("embedQuery returned null (unexpected)");
    process.exit(1);
  }
  console.log("dims     :", vec.length);
  console.log("expected :", EMBED_DIMENSIONS);
  console.log("first 4  :", vec.slice(0, 4));
  console.log(
    "magnitude:",
    Math.sqrt(vec.reduce((a, b) => a + b * b, 0)).toFixed(4),
  );

  if (vec.length !== EMBED_DIMENSIONS) {
    console.error(
      `\nERROR: dimension mismatch. Got ${vec.length}, expected ${EMBED_DIMENSIONS}.`,
    );
    process.exit(1);
  }
  console.log("\n✓ embeddings work end-to-end");
}

main().catch((err) => {
  console.error("threw:", err);
  process.exit(1);
});
