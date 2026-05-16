/**
 * GitHub URL parsing.
 *
 * Accepts the common forms users actually paste:
 *
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/branch/...
 *   git@github.com:owner/repo.git
 *   owner/repo
 *
 * Rejects anything that doesn't look like a repo path; the import
 * dialog uses the thrown message verbatim as form feedback.
 */
export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  /** Branch when the URL explicitly carried one (`/tree/<branch>`); else null. */
  branch: string | null;
}

const GH_HOSTS = new Set(["github.com", "www.github.com"]);

export function parseGitHubUrl(input: string): ParsedRepoUrl {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Paste a GitHub repo URL.");
  }

  // Short form: owner/repo
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    const [owner, repo] = raw.split("/");
    return { owner, repo: stripGitSuffix(repo), branch: null };
  }

  // SSH form: git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2], branch: null };
  }

  // HTTPS form
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a GitHub URL.");
  }
  if (!GH_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only github.com URLs are supported right now.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("URL is missing the repo path (owner/repo).");
  }
  const owner = parts[0];
  const repo = stripGitSuffix(parts[1]);
  // /tree/<branch>/<...optional path...>
  let branch: string | null = null;
  if (parts[2] === "tree" && parts[3]) {
    branch = parts[3];
  }
  return { owner, repo, branch };
}

function stripGitSuffix(s: string): string {
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}
