/**
 * Verify tree-sitter chunking against this repo's own source files.
 *
 *   bun scripts/chunk-code-smoke.ts src/lib/rag/retrieve.ts
 *   bun scripts/chunk-code-smoke.ts src/components/board/excalidraw/canvas-tools.ts
 */
import fs from "node:fs/promises";

import { chunkCodeFile } from "@/lib/rag/chunk-code";

const target = process.argv[2];
if (!target) {
  console.error("Usage: bun scripts/chunk-code-smoke.ts <path>");
  process.exit(1);
}

const content = await fs.readFile(target, "utf-8");
const t0 = Date.now();
const chunks = await chunkCodeFile(content, { filePath: target });
const ms = Date.now() - t0;

console.log(`${chunks.length} chunks · ${ms}ms · ${content.split("\n").length} lines in source\n`);
for (const [i, c] of chunks.entries()) {
  const firstLine = c.content.split("\n")[1] ?? "";
  console.log(
    `  #${String(i).padStart(3)} ${(c.anchor ?? "?").padEnd(14)} ${c.tokens}tok  ${firstLine.slice(3, 80)}`,
  );
}
