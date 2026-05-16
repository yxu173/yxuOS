/**
 * Decide which files in a fetched tarball are worth embedding.
 *
 * The rules are intentionally conservative:
 *
 *   1. Path-segment ignore: anything inside a build-output / vendored
 *      / dependency directory is dropped wholesale. These produce
 *      huge embedding bills for zero retrieval value (nobody asks
 *      the brain "show me the minified bundle").
 *
 *   2. Extension whitelist: we only keep source / markup / config
 *      files the agent is plausibly going to be asked about. Binary
 *      assets, fonts, images, and proprietary formats are dropped.
 *
 *   3. Size cap: any file > MAX_BYTES is treated as binary noise
 *      (generated SQL dumps, vendored JSON manifests, etc.) and
 *      skipped. The threshold is per-file so a single rogue 5MB
 *      JSON doesn't poison the cap for the whole repo.
 *
 * Returning a structured `{ keep, reason }` instead of a boolean
 * lets the indexer surface skip counts in the UI ("ignored 12,030
 * files in node_modules") — much friendlier than a silent drop.
 */

export interface FileDecision {
  keep: boolean;
  /** When `keep === false`, why. Used for progress reporting. */
  reason?: "ignored_dir" | "wrong_ext" | "too_large" | "binary" | "empty";
}

/** Per-file hard cap. Above this we treat the file as noise. */
export const MAX_FILE_BYTES = 256 * 1024;

/**
 * Path segments that, if they appear anywhere in the file's path,
 * cause us to skip the file. Matched as exact segments — `node_modules/x`
 * matches, `mynode_modulesthing/x` doesn't.
 */
const IGNORED_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vercel",
  ".output",
  "dist",
  "build",
  "out",
  "target", // Rust / Java
  "vendor", // Go / PHP
  "Pods", // iOS
  ".gradle",
  ".idea",
  ".vscode",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".terraform",
  "bower_components",
  ".sass-cache",
  ".docusaurus",
  ".storybook-out",
  "storybook-static",
  ".husky",
  "logs",
  "tmp",
  "temp",
]);

/**
 * Specific filenames to drop. Lock files dominate this list — they
 * are huge, change frequently, and tell the brain nothing useful
 * about the project.
 */
const IGNORED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "go.sum",
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * Extensions we *do* index. Everything else is dropped. Kept as a
 * set for O(1) lookup; entries are lowercase **without** the dot.
 *
 * Coverage philosophy: source files for popular languages, plus
 * markup / config / schema files (where most "what does this
 * project do?" questions land). Skip everything binary even if it
 * has a known extension.
 */
const KEEP_EXTENSIONS = new Set([
  // TS / JS family
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "vue",
  "svelte",
  "astro",
  // Python
  "py",
  "pyi",
  "pyx",
  // JVM
  "java",
  "kt",
  "kts",
  "scala",
  "groovy",
  // .NET
  "cs",
  "fs",
  "vb",
  // Systems
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "hh",
  "cxx",
  "hxx",
  "rs",
  "go",
  "zig",
  "swift",
  "m",
  "mm",
  // Scripting
  "rb",
  "php",
  "pl",
  "pm",
  "lua",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  // Functional
  "ex",
  "exs",
  "erl",
  "hrl",
  "clj",
  "cljs",
  "edn",
  "ml",
  "mli",
  "hs",
  "elm",
  // Data / schema
  "sql",
  "graphql",
  "gql",
  "proto",
  "thrift",
  "avsc",
  "cue",
  // Config / infra
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "conf",
  "config",
  "tf",
  "tfvars",
  "hcl",
  "nomad",
  "dockerfile",
  // Markup / docs
  "md",
  "mdx",
  "rst",
  "txt",
  "adoc",
  // Web markup
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  // Build files
  "gradle",
  "cmake",
  "make",
  "mk",
  "bazel",
  "bzl",
  "rake",
]);

/**
 * Filenames (no extension) we always keep. Captures the "Dockerfile",
 * "Makefile" pattern where the file has no extension but is clearly
 * source / config worth indexing.
 */
const KEEP_FILENAMES = new Set([
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Vagrantfile",
  "Brewfile",
  "Justfile",
  "LICENSE",
  "README",
  "CHANGELOG",
  "AUTHORS",
  "CONTRIBUTING",
  "SECURITY",
]);

export function classifyFile(
  path: string,
  byteSize: number,
  isBinaryHint = false,
): FileDecision {
  if (byteSize === 0) {
    return { keep: false, reason: "empty" };
  }
  if (byteSize > MAX_FILE_BYTES) {
    return { keep: false, reason: "too_large" };
  }
  if (isBinaryHint) {
    return { keep: false, reason: "binary" };
  }

  // Tarball entries from `/tarball` come prefixed with a top-level
  // `owner-repo-sha/` segment we want to ignore for matching.
  const parts = path.split("/").filter(Boolean);
  // Drop the GitHub-injected wrapping dir if present.
  const segments = parts.length > 1 ? parts.slice(1) : parts;

  for (const seg of segments) {
    if (IGNORED_DIR_SEGMENTS.has(seg)) {
      return { keep: false, reason: "ignored_dir" };
    }
  }

  const filename = segments[segments.length - 1] ?? "";
  if (IGNORED_FILENAMES.has(filename)) {
    return { keep: false, reason: "ignored_dir" };
  }
  if (KEEP_FILENAMES.has(filename)) {
    return { keep: true };
  }

  // Treat "*.Dockerfile" etc. as a known kind.
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) {
    // No extension and not in the explicit allow-list ⇒ drop.
    return { keep: false, reason: "wrong_ext" };
  }
  const ext = filename.slice(dotIdx + 1).toLowerCase();
  if (KEEP_EXTENSIONS.has(ext)) {
    return { keep: true };
  }
  return { keep: false, reason: "wrong_ext" };
}

/**
 * Strip the GitHub tarball's wrapping directory from a path so the
 * stored path matches what the user sees on github.com.
 *
 * GitHub's `/tarball/<ref>` always wraps everything in a top-level
 * `<owner>-<repo>-<sha-7>/` directory. We don't want that prefix
 * leaking into stored chunks or search results.
 */
export function stripTarballPrefix(path: string): string {
  const idx = path.indexOf("/");
  if (idx === -1) return path;
  return path.slice(idx + 1);
}

/**
 * Cheap binary sniff: if the first 4KB contains a NUL byte, we
 * treat the buffer as binary. Catches images / fonts / compiled
 * artifacts that slipped through extension filtering (e.g. a `.bin`
 * file masquerading under a known extension).
 */
export function looksBinary(buf: Uint8Array): boolean {
  const cap = Math.min(buf.length, 4096);
  for (let i = 0; i < cap; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
