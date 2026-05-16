/**
 * Smoke test: stream a small public repo and report what got kept
 * vs skipped. Useful for sanity-checking the filter rules and the
 * tarball pipeline before wiring it into the real indexer.
 *
 * Usage:  bun scripts/repo-fetch-smoke.ts owner/repo [branch]
 * Example: bun scripts/repo-fetch-smoke.ts sindresorhus/is-odd
 */
import "dotenv/config";

import {
  fetchBranchSha,
  fetchRepoMetadata,
  streamRepoFiles,
} from "@/lib/repos/github";
import { parseGitHubUrl } from "@/lib/repos/url";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun scripts/repo-fetch-smoke.ts owner/repo [branch]");
  process.exit(1);
}

const branchOverride = process.argv[3] ?? null;
const token = process.env.GITHUB_TOKEN ?? null;

async function main() {
  const { owner, repo, branch: parsedBranch } = parseGitHubUrl(arg);
  const meta = await fetchRepoMetadata(owner, repo, token);
  const ref = branchOverride ?? parsedBranch ?? meta.defaultBranch;
  console.log(`Repo: ${meta.owner}/${meta.repo}  default=${meta.defaultBranch}  size=${(meta.size / 1024).toFixed(0)}KB  private=${meta.private}`);
  console.log(`Streaming ref: ${ref}`);

  const sha = await fetchBranchSha(meta.owner, meta.repo, ref, token);
  console.log(`Branch tip SHA: ${sha}`);

  const skipReasons = new Map<string, number>();
  const keptByExt = new Map<string, number>();
  let keptBytes = 0;

  const t0 = Date.now();
  const result = await streamRepoFiles(meta.owner, meta.repo, ref, token, {
    onFile: ({ path, size }) => {
      const ext = path.includes(".")
        ? path.slice(path.lastIndexOf(".") + 1).toLowerCase()
        : "(none)";
      keptByExt.set(ext, (keptByExt.get(ext) ?? 0) + 1);
      keptBytes += size;
    },
    onSkip: (_p, reason) => {
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
    },
  });
  const ms = Date.now() - t0;

  console.log(`\n${result.total} entries · kept ${result.kept} · skipped ${result.skipped}  (${ms}ms, ${(keptBytes / 1024).toFixed(0)}KB)`);
  console.log("\nKept by extension:");
  for (const [ext, n] of [...keptByExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${ext.padEnd(10)} ${n}`);
  }
  console.log("\nSkip reasons:");
  for (const [reason, n] of [...skipReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(14)} ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
