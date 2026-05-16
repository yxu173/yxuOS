/**
 * Server-side text digest of an Excalidraw board snapshot.
 *
 * The design / planner / researcher agents can mention boards in
 * chat (`@<board-name>`). Boards are dense scenes with sticky notes,
 * frames, geo shapes, arrow graphs, full markdown cards, and full
 * mermaid diagrams — too much to fit in a JSON header and not
 * really meant to be looked at pixel-by-pixel. So we walk the
 * snapshot here, in pure JS (no Excalidraw runtime required), and
 * emit a readable plain-text "digest" the model can scan.
 *
 * The digest is grouped by category (Frames, Sticky notes, Text,
 * Geo, Markdown cards, Mermaid cards, Connections) so the agent can
 * scan the structure first and only zoom into the bodies it cares
 * about. Markdown and mermaid bodies are copied **verbatim** inside
 * fenced blocks — that's the whole point of this feature; the agent
 * should be able to read the spec.
 *
 * This module is intentionally NOT an Excalidraw consumer: importing
 * `@excalidraw/excalidraw` here would balloon the server bundle and
 * (worse) reach for `window` at module load. Instead we walk the
 * element list ourselves with `unknown`-ish typing so a stale /
 * partial blob never crashes the digest.
 *
 * Pre-Phase 4 this walked tldraw's `store` map. After Phase 4 every
 * board is on Excalidraw, so the walker only knows about
 * Excalidraw's flat `elements` array. Any other shape (including
 * the legacy tldraw blob, in case a row slips through the wipe)
 * degrades to an empty body with a clear "[empty board]" line.
 */

/* ─── Types we accept ─────────────────────────────────────────── */

/**
 * Loose shape of the persisted Excalidraw snapshot as it sits in
 * `boards.snapshot`. We deliberately type it as `unknown`-ish so a
 * stale / partial blob from an older schema doesn't crash the
 * digest — every accessor is null-checked.
 *
 * Kept the historical name `RawBoardSnapshot` so callers don't have
 * to change.
 */
export interface RawBoardSnapshot {
  /** Engine tag. Should be `"excalidraw"` for current boards. */
  engine?: string;
  /** Excalidraw element list. */
  elements?: unknown;
  /** Anything else is ignored. */
  [key: string]: unknown;
}

export interface DigestBoardInput {
  /** Display name as it appears in the UI ("Onboarding flow"). */
  name: string;
  /** Project the board lives in, for human context. */
  projectName?: string | null;
  /** Snapshot blob from `boards.snapshot`. May be null for empty boards. */
  snapshot: RawBoardSnapshot | null | undefined;
  /** Last edited timestamp. Used only to print a short "edited Xd ago". */
  updatedAt?: Date | string | null;
}

export interface DigestOptions {
  /**
   * Soft cap on the rendered digest length, including the framing
   * markers. Truncation drops detail in the order documented in the
   * file header (markdown bodies first, then mermaid bodies, sticky
   * notes, geo/text labels, finally the connections list). Default
   * 6 KB — leaves room for ~3 boards inside a single 18 KB-budget
   * message.
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 6 * 1024;

/** Per-line cap for shape labels so a single overlong sticky doesn't dominate. */
const LABEL_LINE_CAP = 240;

/** Per-card cap for markdown / mermaid bodies before truncation kicks in. */
const BODY_HARD_CAP = 4000;

/* ─── Excalidraw element model (loose) ───────────────────────── */

/**
 * Minimal structural view of an Excalidraw element. We never trust
 * any field — everything is read through a guarded accessor.
 */
interface RawElement {
  id?: string;
  type?: string;
  text?: string;
  name?: string;
  isDeleted?: boolean;
  width?: number;
  height?: number;
  customData?: Record<string, unknown> | null;
  containerId?: string | null;
  boundElements?: Array<{ type?: string; id?: string }> | null;
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
  frameId?: string | null;
}

interface BucketedShapes {
  frames: RawElement[];
  notes: RawElement[];
  geo: RawElement[];
  text: RawElement[];
  markdownCards: RawElement[];
  mermaidCards: RawElement[];
  arrows: RawElement[];
  /** id → element, for label resolution. */
  byId: Map<string, RawElement>;
  /** id → bound text label string, computed lazily. */
  labelOf: Map<string, string>;
}

/* ─── Public API ──────────────────────────────────────────────── */

/**
 * Walk `board.snapshot` and return a single text block bracketed by
 * `[mentioned-board: <name>] … [/mentioned-board]`. If the board is
 * empty (no shapes), the block still renders — it's important the
 * agent knows the user picked an empty board, and it's better for it
 * to ask one clarifying question than silently hallucinate content.
 */
export function boardSnapshotToDigest(
  board: DigestBoardInput,
  opts: DigestOptions = {},
): string {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const buckets = bucketElements(board.snapshot);

  const headerLines: string[] = [];
  headerLines.push(`[mentioned-board: ${oneLine(board.name)}]`);
  const meta: string[] = [];
  if (board.projectName) meta.push(`project: ${oneLine(board.projectName)}`);
  if (board.updatedAt) {
    const ago = humanAge(board.updatedAt);
    if (ago) meta.push(`edited ${ago}`);
  }
  if (meta.length > 0) headerLines.push(meta.join(" \u00b7 "));

  const body: string[] = [];

  if (buckets.frames.length === 0 && totalShapeCount(buckets) === 0) {
    body.push("[empty board]");
  } else {
    if (buckets.frames.length > 0) {
      body.push(`Frames (${buckets.frames.length}):`);
      for (const f of buckets.frames) {
        const name = elementLabel(f, buckets) || "(unnamed)";
        body.push(`- ${truncateLine(name)}`);
      }
    }
    if (buckets.notes.length > 0) {
      body.push("");
      body.push(`Sticky notes (${buckets.notes.length}):`);
      for (const n of buckets.notes) {
        const text = elementLabel(n, buckets);
        body.push(`- ${truncateLine(text || "(empty note)")}`);
      }
    }
    if (buckets.geo.length > 0) {
      body.push("");
      body.push(`Shapes (${buckets.geo.length}):`);
      for (const g of buckets.geo) {
        const label = elementLabel(g, buckets);
        const subtype = g.type ?? "shape";
        body.push(
          label
            ? `- ${subtype} [${truncateLine(label)}]`
            : `- ${subtype}`,
        );
      }
    }
    if (buckets.text.length > 0) {
      body.push("");
      body.push(`Text (${buckets.text.length}):`);
      for (const t of buckets.text) {
        const text = typeof t.text === "string" ? t.text : "";
        body.push(`- ${truncateLine(text || "(empty)")}`);
      }
    }
    if (buckets.markdownCards.length > 0) {
      body.push("");
      body.push(`Markdown cards (${buckets.markdownCards.length}):`);
      for (const card of buckets.markdownCards) {
        const md = typeof card.customData?.markdown === "string"
          ? card.customData.markdown
          : "";
        body.push("```markdown");
        body.push(capBody(md));
        body.push("```");
      }
    }
    if (buckets.mermaidCards.length > 0) {
      body.push("");
      body.push(`Mermaid cards (${buckets.mermaidCards.length}):`);
      for (const card of buckets.mermaidCards) {
        const src = typeof card.customData?.mermaid === "string"
          ? card.customData.mermaid
          : "";
        body.push("```mermaid");
        body.push(capBody(src));
        body.push("```");
      }
    }
    if (buckets.arrows.length > 0) {
      const lines = renderConnections(buckets);
      if (lines.length > 0) {
        body.push("");
        body.push(`Connections (${lines.length}):`);
        for (const l of lines) body.push(`- ${truncateLine(l)}`);
      }
    }
  }

  return wrap(headerLines, body, board.name, maxBytes);
}

/* ─── Bucketing ────────────────────────────────────────────────── */

function bucketElements(
  raw: RawBoardSnapshot | null | undefined,
): BucketedShapes {
  const out: BucketedShapes = {
    frames: [],
    notes: [],
    geo: [],
    text: [],
    markdownCards: [],
    mermaidCards: [],
    arrows: [],
    byId: new Map(),
    labelOf: new Map(),
  };
  if (!raw || !Array.isArray(raw.elements)) return out;

  const elements = raw.elements as RawElement[];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    if (el.isDeleted) continue;
    if (typeof el.id === "string") out.byId.set(el.id, el);
  }

  // Resolve bound text labels (one pass). A child `text` element with
  // a `containerId` is its container's label; we stash the string by
  // container id so subsequent buckets can read it without looping.
  for (const el of elements) {
    if (el && el.type === "text" && typeof el.text === "string") {
      const container = typeof el.containerId === "string"
        ? el.containerId
        : null;
      if (container) {
        out.labelOf.set(container, el.text);
      }
    }
  }

  for (const el of elements) {
    if (!el || typeof el !== "object" || el.isDeleted) continue;
    const kind =
      el.customData && typeof el.customData === "object"
        ? (el.customData.kind as string | undefined)
        : undefined;
    switch (el.type) {
      case "frame":
      case "magicframe":
        out.frames.push(el);
        break;
      case "arrow":
        out.arrows.push(el);
        break;
      case "text":
        // Bound labels are already accounted for in `labelOf`; only
        // free-standing text elements (no `containerId`) belong in
        // the Text bucket.
        if (!el.containerId) out.text.push(el);
        break;
      case "rectangle":
      case "ellipse":
      case "diamond": {
        if (kind === "note") out.notes.push(el);
        else if (kind === "markdown-card") out.markdownCards.push(el);
        else if (kind === "mermaid-card") out.mermaidCards.push(el);
        else out.geo.push(el);
        break;
      }
      default:
        // Free-draw, lines, images, embeddables — we don't summarise
        // them; they're not the kind of content an agent benefits
        // from. The count still affects `totalShapeCount` so an
        // image-only board doesn't render as "[empty board]".
        out.geo.push(el);
    }
  }

  return out;
}

function totalShapeCount(b: BucketedShapes): number {
  return (
    b.frames.length +
    b.notes.length +
    b.geo.length +
    b.text.length +
    b.markdownCards.length +
    b.mermaidCards.length +
    b.arrows.length
  );
}

/* ─── Label resolution ─────────────────────────────────────────── */

/**
 * Return a human-readable label for an element:
 *   - frames: `name` field
 *   - text:   `text` field
 *   - everything else: bound text label (a child text element whose
 *     `containerId` points back at us), then fall through to type.
 */
function elementLabel(el: RawElement, buckets: BucketedShapes): string {
  if (el.type === "frame" || el.type === "magicframe") {
    return typeof el.name === "string" ? el.name : "";
  }
  if (el.type === "text" && typeof el.text === "string") {
    return el.text;
  }
  if (typeof el.id === "string") {
    const bound = buckets.labelOf.get(el.id);
    if (bound) return bound;
  }
  return "";
}

/* ─── Connections rendering ────────────────────────────────────── */

/**
 * Convert each arrow into a `"<source-label> -> <target-label>"`
 * string. Arrows without bindings or with one missing target are
 * omitted — they don't add structural meaning the agent can use.
 */
function renderConnections(buckets: BucketedShapes): string[] {
  const lines: string[] = [];
  for (const arrow of buckets.arrows) {
    const startId = arrow.startBinding?.elementId;
    const endId = arrow.endBinding?.elementId;
    if (!startId || !endId) continue;
    const startEl = buckets.byId.get(startId);
    const endEl = buckets.byId.get(endId);
    if (!startEl || !endEl) continue;
    const startLabel = elementLabel(startEl, buckets) || startEl.type || "?";
    const endLabel = elementLabel(endEl, buckets) || endEl.type || "?";
    const arrowLabel = typeof arrow.id === "string"
      ? buckets.labelOf.get(arrow.id)
      : undefined;
    lines.push(
      arrowLabel
        ? `${startLabel} \u2192 ${endLabel}  (${arrowLabel})`
        : `${startLabel} \u2192 ${endLabel}`,
    );
  }
  return lines;
}

/* ─── Formatting helpers ───────────────────────────────────────── */

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncateLine(s: string): string {
  const flat = oneLine(s);
  return flat.length > LABEL_LINE_CAP
    ? `${flat.slice(0, LABEL_LINE_CAP - 1)}\u2026`
    : flat;
}

function capBody(s: string): string {
  return s.length > BODY_HARD_CAP
    ? `${s.slice(0, BODY_HARD_CAP)}\n\n[\u2026 truncated, ${s.length - BODY_HARD_CAP} more chars]`
    : s;
}

function humanAge(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function wrap(
  headerLines: string[],
  body: string[],
  name: string,
  maxBytes: number,
): string {
  const open = headerLines.join("\n");
  const close = `[/mentioned-board: ${oneLine(name)}]`;
  // Frame the body, then enforce `maxBytes` by trimming the body
  // tail (we never truncate the header — losing project/date
  // context isn't useful, but losing the last few sticky notes is
  // fine because the cap is already at ~6 KB).
  let full = `${open}\n${body.join("\n")}\n${close}`;
  if (Buffer.byteLength(full, "utf8") <= maxBytes) return full;
  const cap = Math.max(64, maxBytes - close.length - 32);
  full = `${open}\n${body.join("\n")}`;
  if (Buffer.byteLength(full, "utf8") > cap) {
    // Greedy line-by-line trim so we don't split inside a code fence
    // or mid-line.
    const lines = body.slice();
    while (lines.length > 0) {
      const candidate = `${open}\n${lines.join("\n")}`;
      if (Buffer.byteLength(candidate, "utf8") <= cap) break;
      lines.pop();
    }
    full = `${open}\n${lines.join("\n")}\n[\u2026 digest truncated]`;
  }
  return `${full}\n${close}`;
}
