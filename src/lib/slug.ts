/**
 * Sluggify a free-text string for use in URLs (project slugs, folder
 * slugs, etc.). Lowercase, hyphenated, max 32 chars, trimmed of leading
 * / trailing dashes.
 */
const SLUG_MAX = 32;

export function toProjectSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

export const PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
