"use client";

/**
 * Single client-side mermaid loader. Both the MermaidCardShape (renders SVG)
 * and the add_mermaid_card tool (validates source before creating the card)
 * import from here so the ~600 KB mermaid bundle is fetched at most once
 * per session and `mermaid.initialize` runs at most once per page.
 */

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
let initialized = false;

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  const mermaid = await mermaidPromise;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "ui-sans-serif, system-ui",
    });
    initialized = true;
  }
  return mermaid;
}

/**
 * Throws a friendly error if the source is invalid mermaid. Used by the
 * server-defined add_mermaid_card tool to fail fast — the agent then sees
 * the error in its tool-result and retries with corrected syntax.
 */
export async function validateMermaid(source: string): Promise<void> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Mermaid syntax: ${message}`);
  }
}

/**
 * Render mermaid source to inline SVG. Returns the SVG string ready to drop
 * into a container via `dangerouslySetInnerHTML`.
 */
export async function renderMermaid(
  id: string,
  source: string,
): Promise<string> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(id, source);
  return svg;
}
