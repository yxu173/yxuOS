import { generateText } from "ai";

import { models } from "@/lib/ai";

/**
 * Default titles that signal "the user hasn't named this yet".
 * When the artifact still carries one of these, the first user
 * message triggers an AI-generated title.
 */
export const DEFAULT_BOARD_NAME = "Untitled board";
export const DEFAULT_DESIGN_NAME = "Untitled design";
export const DEFAULT_RESEARCH_TITLE = "Untitled research";
export const DEFAULT_PLAN_TITLE = "Untitled plan";

const ALL_DEFAULTS = new Set([
  DEFAULT_BOARD_NAME,
  DEFAULT_DESIGN_NAME,
  DEFAULT_RESEARCH_TITLE,
  DEFAULT_PLAN_TITLE,
]);

/**
 * Returns true when the current name is one of the factory defaults
 * and therefore eligible for auto-naming.
 */
export function needsTitle(current: string | null | undefined): boolean {
  if (!current) return true;
  return ALL_DEFAULTS.has(current.trim());
}

/**
 * Extract the first genuine user sentence from a message payload.
 * We strip pinned-elements headers, mention digests, and file
 * references so the title reflects intent rather than plumbing.
 */
export function extractUserPrompt(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inHeader = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[pinned-elements]")) {
      inHeader = true;
      continue;
    }
    if (inHeader && line === "") {
      inHeader = false;
      continue;
    }
    if (line.startsWith("[mentioned-board:") || line.startsWith("[research-note") || line.startsWith("[plan ")) {
      continue;
    }
    if (line.startsWith("[/mentioned-board]") || line.startsWith("[mentioned-content-truncated]")) {
      continue;
    }
    out.push(raw);
  }
  return out.join("\n").trim().slice(0, 800);
}

/**
 * Dig the first user message text out of an AI SDK v6 (or v5)
 * request body. Returns `null` when the payload shape is unexpected
 * or the user message is empty.
 */
export function extractFirstUserText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if ((m as Record<string, unknown>).role !== "user") continue;
    const parts = (m as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) {
      // v5 fallback
      const content = (m as Record<string, unknown>).content;
      if (typeof content === "string" && content.trim()) {
        return extractUserPrompt(content);
      }
      continue;
    }
    for (const p of parts) {
      if (
        p &&
        typeof p === "object" &&
        (p as Record<string, unknown>).type === "text"
      ) {
        const text = String((p as Record<string, unknown>).text ?? "");
        if (text.trim()) return extractUserPrompt(text);
      }
    }
  }
  return null;
}

/**
 * Generate a short, human-readable title from the user's first
 * message. Uses the fast/cheap model (haiku) so the latency is
 * negligible (~150 ms) and cost is tiny.
 *
 * Prompt constraints: ≤ 6 words, no trailing punctuation, ≤ 40 chars.
 * Falls back to a truncated snippet of the prompt if the LLM call
 * fails (rare — usually a rate-limit or transient provider error).
 */
export async function generateChatTitle(
  userPrompt: string,
): Promise<string> {
  const prompt = `Generate a concise title (3-6 words, max 40 characters, no trailing punctuation) for a conversation that starts with this message:\n\n"""\n${userPrompt.slice(0, 800)}\n"""\n\nTitle:`;

  try {
    const { text } = await generateText({
      model: models.haiku,
      prompt,
      maxOutputTokens: 20,
      temperature: 0.3,
    });
    const cleaned = text
      .trim()
      .replace(/\.+$/, "")
      .replace(/["']/g, "")
      .slice(0, 40);
    return cleaned || fallbackTitle(userPrompt);
  } catch {
    return fallbackTitle(userPrompt);
  }
}

function fallbackTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (flat.length <= 40) return flat;
  return flat.slice(0, 37) + "…";
}
