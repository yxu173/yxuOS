import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

import * as tar from "tar-stream";

import {
  classifyFile,
  looksBinary,
  MAX_FILE_BYTES,
  stripTarballPrefix,
} from "./file-filter";

/**
 * Thin GitHub REST client + tarball streamer.
 *
 * Why not Octokit? We only hit 3 endpoints (`/repos/{o}/{r}`,
 * `/repos/{o}/{r}/tarball/{ref}`, `/user` for token validation).
 * Bundling Octokit pulls in ~400KB for that.
 *
 * Why the tarball path instead of recursive `/contents/{path}`
 * walking? Rate limits. The `contents` endpoint costs 1 request
 * per file; a medium repo (5k files) burns through the entire
 * 5k/hr authenticated budget on a single index pass. The tarball
 * endpoint is **one request** for the whole repo and counts as
 * one rate-limit unit. The cost is having to gunzip + untar
 * client-side, which is cheap.
 *
 * Memory profile: we stream-parse the tar archive. Each file's
 * full contents land in memory briefly (bounded by MAX_FILE_BYTES)
 * but we never hold the whole archive at once.
 */

const GH_API = "https://api.github.com";

type GhAuthHeaders = Record<string, string>;

function headers(token: string | null): GhAuthHeaders {
  const h: GhAuthHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "yxuOS-brain-indexer",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** A specific, user-facing error so the API route can map it cleanly. */
export class GitHubFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind:
      | "not_found"
      | "unauthorized"
      | "forbidden"
      | "rate_limited"
      | "network"
      | "too_large"
      | "unknown",
  ) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Bytes — surfaced for the size cap pre-check. */
  size: number;
  private: boolean;
  description: string | null;
}

/**
 * Fetch repo metadata; doubles as a token-validity check (a private
 * repo with a bad token returns 404, not 401, but we surface that
 * as "not found or no access" which is the same UX).
 */
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token: string | null,
): Promise<RepoMetadata> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
    headers: headers(token),
  });
  if (res.status === 404) {
    throw new GitHubFetchError(
      "Repo not found, or your token can't see it.",
      404,
      "not_found",
    );
  }
  if (res.status === 401) {
    throw new GitHubFetchError(
      "GitHub rejected the token. Generate a fresh PAT and retry.",
      401,
      "unauthorized",
    );
  }
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new GitHubFetchError(
        "GitHub rate limit hit. Wait an hour or add a token.",
        403,
        "rate_limited",
      );
    }
    throw new GitHubFetchError(
      "GitHub refused the request (forbidden).",
      403,
      "forbidden",
    );
  }
  if (!res.ok) {
    throw new GitHubFetchError(
      `GitHub returned ${res.status}.`,
      res.status,
      "unknown",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  return {
    owner: json.owner.login,
    repo: json.name,
    defaultBranch: json.default_branch,
    size: (json.size ?? 0) * 1024, // GitHub returns KB
    private: !!json.private,
    description: json.description ?? null,
  };
}

/**
 * Fetch the commit SHA at the tip of `ref`. Used to populate
 * `lastIndexedSha` after a successful pass so re-syncs can
 * short-circuit when nothing changed.
 */
export async function fetchBranchSha(
  owner: string,
  repo: string,
  ref: string,
  token: string | null,
): Promise<string> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`,
    { headers: headers(token) },
  );
  if (!res.ok) {
    throw new GitHubFetchError(
      `Couldn't read branch '${ref}' (HTTP ${res.status}).`,
      res.status,
      res.status === 404 ? "not_found" : "unknown",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  return json.commit?.sha as string;
}

export interface RepoFile {
  /** Path with the GitHub-injected wrapping dir stripped. */
  path: string;
  /** Raw bytes — UTF-8 decoded by the caller after binary detection. */
  bytes: Uint8Array;
  /** Pre-computed size — same as `bytes.length`, surfaced for convenience. */
  size: number;
}

export interface StreamFilesOptions {
  /** Called for each file we KEEP. The bytes buffer is short-lived; copy if you need to retain it. */
  onFile: (file: RepoFile) => Promise<void> | void;
  /** Called for each file we SKIP. The buffer is null for size-skipped files (never read). */
  onSkip: (path: string, reason: string) => void;
  /**
   * Hard cap on total kept-file count. When exceeded we throw a
   * `too_large` error so the caller can surface a "repo too big"
   * message to the user.
   */
  maxFiles?: number;
}

/**
 * Stream a repo tarball, calling `onFile` for every file that
 * passes the filter and `onSkip` for everything else.
 *
 * Why per-file callbacks instead of returning an array? Memory.
 * A 5k-file JS repo materialised as an array of `{path, bytes}`
 * would hold tens of megabytes simultaneously. The streaming
 * shape lets the caller embed + persist each file and discard
 * the bytes immediately.
 */
export async function streamRepoFiles(
  owner: string,
  repo: string,
  ref: string,
  token: string | null,
  opts: StreamFilesOptions,
): Promise<{ kept: number; skipped: number; total: number }> {
  const maxFiles = opts.maxFiles ?? 50_000;
  const url = `${GH_API}/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: headers(token),
    // GitHub's tarball endpoint 302s; node's fetch follows by default.
  });
  if (!res.ok) {
    throw new GitHubFetchError(
      `Couldn't download tarball (HTTP ${res.status}).`,
      res.status,
      res.status === 404 ? "not_found" : "unknown",
    );
  }
  if (!res.body) {
    throw new GitHubFetchError(
      "GitHub returned an empty tarball body.",
      500,
      "network",
    );
  }

  let kept = 0;
  let skipped = 0;
  let total = 0;

  const extract = tar.extract();

  // We bridge Web ReadableStream → Node Readable → gunzip → tar.
  // Node 18+ has `Readable.fromWeb`, but pinning to it here keeps
  // the gunzip pipe simple.
  const nodeStream = Readable.fromWeb(
    res.body as Parameters<typeof Readable.fromWeb>[0],
  );

  // Per-entry promise so we sequence onFile callbacks (which may
  // be async — they typically write to the embedding queue).
  const done = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      // We only care about files; symlinks / dirs / metadata get
      // drained and ignored.
      if (header.type !== "file") {
        stream.on("end", next);
        stream.resume();
        return;
      }
      total++;
      const path = stripTarballPrefix(header.name);
      const size = header.size ?? 0;

      // Cheap path-only filter first — we can skip without
      // buffering the entry's contents at all.
      const earlyDecision = classifyFile(path, size || 1);
      if (!earlyDecision.keep && earlyDecision.reason !== "too_large") {
        skipped++;
        opts.onSkip(path, earlyDecision.reason ?? "filtered");
        stream.on("end", next);
        stream.resume();
        return;
      }

      // Size cap reuses the same threshold the filter would
      // have applied, but we check it here so we can avoid the
      // (potentially large) read.
      if (size > MAX_FILE_BYTES) {
        skipped++;
        opts.onSkip(path, "too_large");
        stream.on("end", next);
        stream.resume();
        return;
      }

      // Buffer the entry. We cap at MAX_FILE_BYTES defensively in
      // case the header lied about the size.
      const chunks: Buffer[] = [];
      let read = 0;
      let truncated = false;
      stream.on("data", (chunk: Buffer) => {
        read += chunk.length;
        if (read > MAX_FILE_BYTES) {
          truncated = true;
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", async () => {
        if (truncated) {
          skipped++;
          opts.onSkip(path, "too_large");
          return next();
        }
        const bytes = Buffer.concat(chunks);
        if (looksBinary(bytes)) {
          skipped++;
          opts.onSkip(path, "binary");
          return next();
        }
        try {
          await opts.onFile({ path, bytes, size: bytes.length });
          kept++;
          if (kept > maxFiles) {
            extract.destroy(
              new GitHubFetchError(
                `Repo exceeds the ${maxFiles}-file cap. Trim it or raise the cap.`,
                413,
                "too_large",
              ),
            );
            return;
          }
        } catch (err) {
          extract.destroy(err as Error);
          return;
        }
        next();
      });
      stream.on("error", (err) => next(err));
    });
    extract.on("finish", () => resolve());
    extract.on("error", (err) => reject(err));
  });

  // gunzip → tar
  nodeStream.pipe(createGunzip()).pipe(extract);

  await done;
  return { kept, skipped, total };
}
