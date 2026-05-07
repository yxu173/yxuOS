import type { MentionTarget } from "./types";

const HANDLE_CHAR = /[a-zA-Z0-9_.]/;

export interface MentionTrigger {
  /** Position of the leading `@` in the textarea value. */
  start: number;
  /** Position of the cursor — used for the popover anchor. */
  end: number;
  /** Lowercase prefix typed after the `@` (no leading `@`). */
  prefix: string;
}

/**
 * Looks at the textarea value + cursor and decides whether the user is
 * mid-mention. Returns `null` when they aren't (so the popover is hidden).
 *
 * A trigger is the most recent `@` at or before the cursor where:
 *   - the char before the `@` is whitespace or start-of-string, AND
 *   - every char between the `@` and the cursor is a valid handle char.
 */
export function detectMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  const before = value.slice(0, caret);
  // Walk backwards from the caret to find the start of a token.
  let i = caret;
  while (i > 0) {
    const char = before[i - 1];
    if (char === "@") {
      const charBefore = i >= 2 ? before[i - 2] : "";
      const validBoundary = i === 1 || /\s/.test(charBefore);
      if (!validBoundary) return null;
      const prefix = before.slice(i, caret);
      // Already-completed mention has no further matching to do (the user
      // moved past it with a space) — but the walk above terminated at the
      // first `@`, so by definition `prefix` only contains handle chars.
      return { start: i - 1, end: caret, prefix: prefix.toLowerCase() };
    }
    if (!HANDLE_CHAR.test(char)) return null;
    i -= 1;
  }
  return null;
}

/**
 * Filters team members to those that match `prefix` either by username
 * (preferred) or by name (fallback for when the user's still searching).
 * Caps at 6 to keep the popover compact.
 */
export function filterMentionCandidates(
  members: MentionTarget[],
  prefix: string,
): MentionTarget[] {
  const lower = prefix.toLowerCase();
  if (!lower) return members.slice(0, 6);
  return members
    .filter((m) => {
      const handle = (m.username ?? "").toLowerCase();
      const name = m.name.toLowerCase();
      return handle.startsWith(lower) || name.includes(lower);
    })
    .slice(0, 6);
}

/**
 * Returns the new textarea value + caret after replacing the active
 * mention prefix with `@<username>` plus a trailing space.
 */
export function applyMention(
  value: string,
  trigger: MentionTrigger,
  username: string,
): { value: string; caret: number } {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end);
  const insertion = `@${username} `;
  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}
