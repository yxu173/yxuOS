import { createRequire } from "node:module";
import path from "node:path";

import Parser from "web-tree-sitter";

/**
 * Resolve the `tree-sitter-wasms` package directory once, lazily,
 * via `createRequire(import.meta.url)`. This works in three places
 * the previous `path.join(process.cwd(), "node_modules", ...)` did
 * NOT work in:
 *
 *   1. **Vercel / serverless functions.** `process.cwd()` is
 *      `/var/task`, not the repo root, and even when it matches,
 *      the bundler may hoist the package somewhere else.
 *   2. **pnpm / bun isolated installs.** The grammar package lives
 *      under `.pnpm/<hash>/node_modules/tree-sitter-wasms`, never
 *      `<cwd>/node_modules/tree-sitter-wasms`.
 *   3. **Monorepo subfolders.** `cwd` is whichever package you
 *      ran from — not necessarily the one that depends on us.
 *
 * `require.resolve` consults the actual module graph that loaded
 * this file, so it returns the right path regardless of layout.
 *
 * Memo: the resolution is module-level so we pay the lookup once
 * per process, then reuse the directory for every grammar.
 */
let _wasmDir: string | null | undefined;
function wasmDir(): string | null {
  if (_wasmDir !== undefined) return _wasmDir;
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve("tree-sitter-wasms/package.json");
    _wasmDir = path.join(path.dirname(pkgPath), "out");
    return _wasmDir;
  } catch {
    // Last-ditch fallback for environments where createRequire
    // can't find the package (vanishingly rare). Keeps the old
    // behaviour so we don't regress local dev.
    const guess = path.join(
      process.cwd(),
      "node_modules",
      "tree-sitter-wasms",
      "out",
    );
    _wasmDir = guess;
    return _wasmDir;
  }
}

import type { Chunk } from "./chunk";

/**
 * web-tree-sitter pinned to 0.22.6 so the WASM grammars shipped
 * by `tree-sitter-wasms@0.1.13` actually load — newer versions of
 * web-tree-sitter expect a newer dylink metadata block and reject
 * the prebuilt grammars with `failIf` from getDylinkMetadata.
 */

/**
 * Code-aware chunker for repo files.
 *
 * Plain-prose chunkers split on paragraphs / sentences. Code has
 * different structure — splitting in the middle of a function
 * destroys the semantic signal the embedder is trying to capture.
 * So we use tree-sitter to find top-level declarations (functions,
 * classes, type aliases, exported consts) and pack them into chunks
 * up to a token budget.
 *
 * Falls back to line-window chunking when:
 *   - the file's language isn't supported (we ship 7 grammars; the
 *     rest get line-window),
 *   - a single declaration is larger than the chunk budget (we
 *     line-window that one declaration).
 *
 * Why not the dumb chunker for everything? Empirically, code with
 * top-level boundaries preserved retrieves dramatically better:
 * embeddings for "the X function" land on the function, not on
 * a sliding window that happens to straddle X and an adjacent
 * unrelated helper.
 *
 * Memory note: `Parser.init()` and `Language.load()` are slow
 * (~30-100ms each). We cache them as module-level singletons, so
 * a whole-repo pass pays the setup cost once.
 */

const CODE_CHUNK_TARGET_LINES = 120;
const CODE_CHUNK_OVERLAP_LINES = 20;
const CODE_CHUNK_MAX_TOKENS = 1200; // approximate, text.length / 4

/** Map file extension → tree-sitter grammar filename in tree-sitter-wasms. */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cxx: "cpp",
  hxx: "cpp",
};

/**
 * Node "types" we treat as **chunkable top-level declarations**.
 * These are the cross-language equivalents of "things worth their
 * own chunk" — function definitions, classes, interfaces, type
 * aliases. Anything else (import statements, comments at file
 * scope, etc.) gets folded into the surrounding chunk so we don't
 * fragment trivia.
 *
 * The lists are per-grammar because tree-sitter node names differ
 * across languages.
 */
const DECLARATION_NODE_TYPES: Record<string, Set<string>> = {
  typescript: new Set([
    "function_declaration",
    "class_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "export_statement",
    "lexical_declaration",
    "variable_declaration",
    "method_definition",
    "abstract_class_declaration",
  ]),
  tsx: new Set([
    "function_declaration",
    "class_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "export_statement",
    "lexical_declaration",
    "variable_declaration",
  ]),
  javascript: new Set([
    "function_declaration",
    "class_declaration",
    "export_statement",
    "lexical_declaration",
    "variable_declaration",
    "method_definition",
  ]),
  python: new Set([
    "function_definition",
    "class_definition",
    "decorated_definition",
  ]),
  go: new Set([
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "const_declaration",
    "var_declaration",
  ]),
  rust: new Set([
    "function_item",
    "impl_item",
    "struct_item",
    "enum_item",
    "trait_item",
    "type_item",
    "mod_item",
    "macro_definition",
  ]),
  java: new Set([
    "method_declaration",
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
  ]),
  ruby: new Set(["method", "class", "module", "singleton_method"]),
  c: new Set(["function_definition", "declaration", "struct_specifier"]),
  cpp: new Set([
    "function_definition",
    "class_specifier",
    "struct_specifier",
    "namespace_definition",
    "template_declaration",
  ]),
};

/* ─── parser / language singletons ───────────────────────── */

let parserInitPromise: Promise<void> | null = null;
const languageCache = new Map<string, Promise<Parser.Language>>();

async function initParser(): Promise<void> {
  if (!parserInitPromise) {
    parserInitPromise = Parser.init();
  }
  return parserInitPromise;
}

async function loadLanguage(grammar: string): Promise<Parser.Language> {
  const cached = languageCache.get(grammar);
  if (cached) return cached;
  const dir = wasmDir();
  if (!dir) {
    throw new Error(
      "tree-sitter-wasms package not resolvable — reinstall deps",
    );
  }
  const wasmPath = path.join(dir, `tree-sitter-${grammar}.wasm`);
  // web-tree-sitter accepts a path string in Node.
  const p = Parser.Language.load(wasmPath);
  languageCache.set(grammar, p);
  return p;
}

/** Pick a grammar by filename. Returns null when unsupported. */
function grammarFor(filePath: string): string | null {
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return EXT_TO_GRAMMAR[ext] ?? null;
}

/* ─── chunkers ──────────────────────────────────────────── */

interface CodeChunkOptions {
  /** Repo-relative path; embedded in the chunk header for citation. */
  filePath: string;
}

/**
 * Public entry point. Picks AST-aware or line-window chunking
 * based on whether we have a grammar for the file's extension.
 */
export async function chunkCodeFile(
  content: string,
  opts: CodeChunkOptions,
): Promise<Chunk[]> {
  if (!content.trim()) return [];
  const grammar = grammarFor(opts.filePath);
  if (!grammar) {
    return lineWindowChunks(content, opts.filePath);
  }

  try {
    await initParser();
    const lang = await loadLanguage(grammar);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    if (!tree) {
      return lineWindowChunks(content, opts.filePath);
    }
    const root = tree.rootNode;
    const declSet =
      DECLARATION_NODE_TYPES[grammar] ?? new Set<string>();

    // Walk only the top-level (root.namedChildren). Nested
    // declarations stay attached to their parent — that's the
    // whole point of preserving structure.
    const lines = content.split("\n");
    const tops: Array<{ startLine: number; endLine: number }> = [];
    for (const child of root.namedChildren) {
      if (!child) continue;
      if (!declSet.has(child.type)) continue;
      tops.push({
        startLine: child.startPosition.row,
        endLine: child.endPosition.row,
      });
    }
    parser.delete();

    if (tops.length === 0) {
      // Nothing top-level recognised (config file, mostly imports,
      // etc.) — line-window the whole thing.
      return lineWindowChunks(content, opts.filePath);
    }

    return packDeclarationsIntoChunks(lines, tops, opts.filePath);
  } catch (err) {
    // Tree-sitter failure (parse error, OOM, missing grammar
    // build) shouldn't kill the indexer — fall back to line
    // windowing and keep going. Log the first few so a real
    // misconfiguration (e.g. wasm files missing in deployment)
    // is visible instead of silently degrading every file.
    if (!_warnedGrammars.has(grammar)) {
      _warnedGrammars.add(grammar);
      console.warn(
        `[rag/chunk-code] tree-sitter '${grammar}' unavailable; using line-window fallback. cause:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return lineWindowChunks(content, opts.filePath);
  }
}

/** One-warning-per-grammar so deployment misconfigs surface loudly once. */
const _warnedGrammars = new Set<string>();

/**
 * Pack a sequence of declaration ranges into chunks bounded by
 * the token budget. Lines BETWEEN declarations (imports, top-level
 * comments) are attached to the next chunk so we don't lose them.
 */
function packDeclarationsIntoChunks(
  lines: string[],
  declarations: Array<{ startLine: number; endLine: number }>,
  filePath: string,
): Chunk[] {
  const chunks: Chunk[] = [];

  // Cover everything from line 0 to EOF, splitting at declaration
  // boundaries but including pre-amble and post-amble.
  let cursor = 0;
  let chunkStart = 0;
  let chunkBudget = 0;

  const flush = (endLine: number) => {
    if (endLine < chunkStart) return;
    const sub = lines.slice(chunkStart, endLine + 1).join("\n");
    if (!sub.trim()) {
      chunkStart = endLine + 1;
      chunkBudget = 0;
      return;
    }
    chunks.push(makeChunk(sub, chunkStart, endLine, filePath));
    chunkStart = endLine + 1;
    chunkBudget = 0;
  };

  for (const decl of declarations) {
    // If the gap before this declaration + the declaration itself
    // would blow the budget AND we already have content buffered,
    // flush first.
    const declSize = (decl.endLine - decl.startLine + 1);
    const gapSize = Math.max(0, decl.startLine - cursor);
    const wouldBe = chunkBudget + gapSize + declSize;

    if (wouldBe > CODE_CHUNK_TARGET_LINES && chunkBudget > 0) {
      flush(cursor - 1);
    }

    // Single declaration is itself larger than budget → recurse
    // with line-window so we don't ship a 1000-line monster chunk.
    if (declSize > CODE_CHUNK_TARGET_LINES * 1.5) {
      // Flush any preamble first.
      if (decl.startLine > chunkStart) {
        flush(decl.startLine - 1);
      }
      const monsterLines = lines.slice(decl.startLine, decl.endLine + 1);
      const subChunks = lineWindowChunks(
        monsterLines.join("\n"),
        filePath,
        decl.startLine,
      );
      chunks.push(...subChunks);
      cursor = decl.endLine + 1;
      chunkStart = cursor;
      chunkBudget = 0;
      continue;
    }

    cursor = decl.endLine + 1;
    chunkBudget = cursor - chunkStart;
  }
  // Tail.
  flush(lines.length - 1);

  return chunks;
}

/**
 * Dumb fallback: chunk by line windows with overlap. Used for
 * unsupported languages, parse failures, and as the inner loop
 * for over-budget single declarations.
 *
 * `baseLine` lets the caller report absolute line numbers when
 * chunking a sub-range of a larger file (so the anchor stays
 * correct).
 */
function lineWindowChunks(
  content: string,
  filePath: string,
  baseLine = 0,
): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const end = Math.min(i + CODE_CHUNK_TARGET_LINES, lines.length);
    const sub = lines.slice(i, end).join("\n");
    if (sub.trim()) {
      chunks.push(makeChunk(sub, baseLine + i, baseLine + end - 1, filePath));
    }
    if (end >= lines.length) break;
    i = end - CODE_CHUNK_OVERLAP_LINES;
    if (i <= 0) break; // sentinel
  }
  return chunks;
}

/**
 * Build a chunk with the language-tagged header that helps the
 * embedder situate the snippet ("this is TypeScript, from
 * src/auth.ts, lines 12-43") and gives the LLM a clear citation
 * format at retrieval time.
 */
function makeChunk(
  body: string,
  startLine: number,
  endLine: number,
  filePath: string,
): Chunk {
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const langTag = LANGUAGE_TAGS[ext] ?? ext;
  // Use 1-based line numbers in the visible header; 0-based in the
  // anchor (for join-by-key with diff tools later).
  const header = `\`\`\`${langTag}\n// ${filePath} (L${startLine + 1}-L${endLine + 1})\n`;
  const text = `${header}${body}\n\`\`\``;
  return {
    content: text,
    tokens: Math.ceil(text.length / 4),
    anchor: `L${startLine + 1}-L${endLine + 1}`,
  };
}
const LANGUAGE_TAGS: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  md: "md",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  sh: "bash",
  bash: "bash",
};

// Re-exported for the smoke script's "this chunk is X tokens" math.
export { CODE_CHUNK_MAX_TOKENS, CODE_CHUNK_TARGET_LINES };
