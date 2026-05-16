/**
 * One-shot validation for GitHub App credentials.
 *
 * Loads `.env.local`, mints an App-level JWT against your private key,
 * and calls `GET /app` to confirm GitHub accepts it. If this passes,
 * the install flow + webhook receiver will work too \u2014 they use the
 * exact same key loader.
 *
 *   bun scripts/github-app-smoke.ts
 */
import "dotenv/config";

import { mintAppJwt, verifyAppCredentials } from "@/lib/github/app-auth";

async function main() {
  console.log("Minting App JWT...");
  const jwt = mintAppJwt();
  // Don't print the JWT; just confirm structure.
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    console.error(`\u274c Malformed JWT: expected 3 parts, got ${parts.length}`);
    process.exit(1);
  }
  console.log(
    `  ok \u2014 header=${parts[0].length}b, payload=${parts[1].length}b, sig=${parts[2].length}b`,
  );

  console.log("Calling GET /app to verify credentials with GitHub...");
  const app = await verifyAppCredentials();
  console.log(`\u2705 Authenticated as App #${app.id} \u2014 @${app.slug} (${app.name})`);
  console.log("\nInstall it on a repo via:");
  console.log(`  https://github.com/apps/${app.slug}/installations/new`);
}

main().catch((err) => {
  console.error("\u274c", err instanceof Error ? err.message : err);
  process.exit(1);
});
