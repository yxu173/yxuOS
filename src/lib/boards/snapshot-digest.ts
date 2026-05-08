/**
 * Server-side text digest of a tldraw board snapshot.
 *
 * The design agent can mention boards in chat (`@<board-name>`). Boards
 * are dense whiteboards with sticky notes, frames, geo shapes, arrow
 * graphs, full markdown cards, and full mermaid diagrams — too much
 * stuff to fit in a JSON header and not really meant to be looked at
 * pixel-by-pixel. So we walk the snapshot here, in pure JS (no tldraw
 * Editor required), and emit a readable plain-text "digest" the model
 * can scan.
 *
 * The digest is grouped by category (Frames, Sticky notes, Text, Geo,
 * Markdown cards, Mermaid cards, Connections) so the agent can scan
 * the structure first and only zoom into the bodies it cares about.
 * Markdown and mermaid bodies are copied **verbatim** inside fenced
 * blocks — that's the whole point of this feature; the agent should
 * be able to read the spec.
 *
 * This module is intentionally NOT a tldraw consumer: we don't import
 * `Editor` / `renderPlaintextFromRichText` / etc. — those are
 * browser-only and would balloon the server bundle. Instead we do a
 * minimal best-effort walk over `props.richText` (a ProseMirror JSON
 * doc) when a shape happens to use it. Plain `props.text` covers the
 * majority of boards we actually see today.
 */

/* ─── Types we accept ───────────────────────────────────── */

/**
 * Loose shape of a tldraw store snapshot as persisted in
 * `boards.snapshot`. We deliberately type this as `unknown`-ish so a
 * stale / partial blob from an older tldraw schema doesn't crash the
 * digest — every accessor is null-checked.
 */
export interface RawBoardSnapshot {
  store?: Record<string, unknown> | null;
  // Other fields (schema, document, …) are ignored.
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

/* ─── Public API ────────────────────────────────────────── */

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
  const buckets = bucketShapes(board.snapshot);

  const headerLines: string[] = [];
  headerLines.push(`[mentioned-board: ${oneLine(board.name)}]`);
  const meta: string[] = [];
  if (board.projectName) meta.push(`project: ${oneLine(board.projectName)}`);
  meta.push(`${buckets.totalShapes} shapes`);
  if (board.updatedAt) {
    const ago = formatAgo(board.updatedAt);
    if (ago) meta.push(`last edited ${ago}`);
  }
  headerLines.push(`(${meta.join(" · ")})`);

  const sections = renderSections(buckets);

  const closing = "[/mentioned-board]";

  // Compose, then truncate progressively until under cap.
  let body = sections.join("\n\n");
  let assembled = `${headerLines.join("\n")}\n\n${body}\n\n${closing}`;
  if (byteLength(assembled) <= maxBytes) return assembled;

  // Truncation passes — each pass mutates `buckets` in place (drops
  // tail content), then we re-render. We keep going until either the
  // digest fits or we've stripped everything but the header + closing.
  const passes: Array<() => void> = [
    // 1) Halve markdown card bodies.
    () => {
      for (const card of buckets.markdownCards) {
        if (card.body.length > 800) {
          card.body = `${card.body.slice(0, 800)}\n…[truncated]`;
        }
      }
    },
    // 2) Halve mermaid card bodies.
    () => {
      for (const card of buckets.mermaidCards) {
        if (card.body.length > 800) {
          card.body = `${card.body.slice(0, 800)}\n…[truncated]`;
        }
      }
    },
    // 3) Drop the back half of sticky notes.
    () => dropTail(buckets.sticky, "sticky note"),
    // 4) Drop the back half of text labels.
    () => dropTail(buckets.text, "text label"),
    // 5) Drop the back half of geo labels.
    () => dropTail(buckets.geo, "geo label"),
    // 6) Drop markdown cards entirely (bodies were the real bloat).
    () => dropAll(buckets.markdownCards, "markdown card"),
    // 7) Drop mermaid cards entirely.
    () => dropAll(buckets.mermaidCards, "mermaid card"),
    // 8) Drop the connections list.
    () => dropAll(buckets.connections, "connection"),
  ];

  for (const pass of passes) {
    pass();
    body = renderSections(buckets).join("\n\n");
    assembled = `${headerLines.join("\n")}\n\n${body}\n\n${closing}`;
    if (byteLength(assembled) <= maxBytes) return assembled;
  }

  return assembled;
}

/* ─── Bucketing ─────────────────────────────────────────── */

interface Buckets {
  totalShapes: number;
  frames: string[];
  sticky: string[];
  text: string[];
  geo: Array<{ kind: string; label: string }>;
  markdownCards: Array<{ name: string; body: string }>;
  mermaidCards: Array<{ kind: string; body: string }>;
  connections: Array<{ from: string; to: string; label?: string }>;
  /** Truncation markers added by `dropTail` / `dropAll`. */
  truncationNotes: string[];
}

interface RawShape {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  parentId?: string;
  // Tldraw v3+: arrow endpoints are separate `binding` records, but
  // older snapshots inline them on the shape. We support both.
}

interface RawBinding {
  id: string;
  type?: string;
  fromId?: string;
  toId?: string;
  props?: Record<string, unknown>;
}

function bucketShapes(snapshot: RawBoardSnapshot | null | undefined): Buckets {
  const buckets: Buckets = {
    totalShapes: 0,
    frames: [],
    sticky: [],
    text: [],
    geo: [],
    markdownCards: [],
    mermaidCards: [],
    connections: [],
    truncationNotes: [],
  };
  const store = snapshot?.store;
  if (!store || typeof store !== "object") return buckets;

  // Build a lookup from shape id → label so arrow rendering can
  // translate `bound[Shape]Id` into the actual sticky/geo/text label.
  const labelById = new Map<string, string>();
  const arrows: RawShape[] = [];
  // Tldraw v3+ arrow bindings stored as separate records: type ===
  // 'arrow', fromId = arrow shape id, toId = bound shape id, props.terminal
  // = "start" | "end".
  const arrowBindings: RawBinding[] = [];

  for (const value of Object.values(store)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const typeName = record.typeName;

    if (typeName === "binding") {
      // We only care about arrow bindings; other binding types are noise.
      if (record.type === "arrow") {
        // Loose cast — the raw record is `Record<string, unknown>` but
        // every field RawBinding cares about is also optional, so the
        // shape lines up at runtime.
        arrowBindings.push(record as unknown as RawBinding);
      }
      continue;
    }
    if (typeName !== "shape") continue;

    const shape: RawShape = {
      id: String(record.id ?? ""),
      type: String(record.type ?? ""),
      props: (record.props ?? {}) as Record<string, unknown>,
      parentId:
        typeof record.parentId === "string" ? record.parentId : undefined,
    };
    buckets.totalShapes += 1;

    const label = extractShapeLabel(shape);
    if (label) labelById.set(shape.id, label);

    switch (shape.type) {
      case "frame": {
        const name = pickString(shape.props, "name") ?? label;
        if (name) buckets.frames.push(clamp(name, LABEL_LINE_CAP));
        break;
      }
      case "note": {
        if (label) buckets.sticky.push(clamp(label, LABEL_LINE_CAP));
        break;
      }
      case "text": {
        if (label) buckets.text.push(clamp(label, LABEL_LINE_CAP));
        break;
      }
      case "geo": {
        const kind = pickString(shape.props, "geo") ?? "rectangle";
        if (label) {
          buckets.geo.push({ kind, label: clamp(label, LABEL_LINE_CAP) });
        } else {
          // Unlabeled geos are rarely useful to the agent; skip them
          // unless they're the ONLY thing on the board, which is
          // covered by the totalShapes count above.
        }
        break;
      }
      case "markdown-card": {
        const md = pickString(shape.props, "markdown") ?? "";
        if (md.trim().length === 0) break;
        const name = firstHeading(md) ?? "untitled";
        buckets.markdownCards.push({
          name: clamp(name, 80),
          body: clamp(md, BODY_HARD_CAP),
        });
        break;
      }
      case "mermaid-card": {
        const src = pickString(shape.props, "mermaid") ?? "";
        if (src.trim().length === 0) break;
        const kind = pickString(shape.props, "kind") ?? "diagram";
        buckets.mermaidCards.push({
          kind: clamp(kind, 40),
          body: clamp(src, BODY_HARD_CAP),
        });
        break;
      }
      case "arrow": {
        arrows.push(shape);
        break;
      }
      default:
        // Custom shapes we don't recognise are counted in
        // `totalShapes` but otherwise ignored.
        break;
    }
  }

  // Resolve arrow endpoints. We try the v3 binding model first
  // (separate `binding` records keyed by `fromId === arrow.id`,
  // `props.terminal`), then fall back to the legacy inline form
  // (`shape.props.start.boundShapeId` / `end.boundShapeId`).
  const bindingsByArrow = new Map<string, { start?: string; end?: string }>();
  for (const binding of arrowBindings) {
    const arrowId = binding.fromId;
    const targetId = binding.toId;
    const terminal = pickString(binding.props, "terminal");
    if (!arrowId || !targetId || !terminal) continue;
    let entry = bindingsByArrow.get(arrowId);
    if (!entry) {
      entry = {};
      bindingsByArrow.set(arrowId, entry);
    }
    if (terminal === "start") entry.start = targetId;
    else if (terminal === "end") entry.end = targetId;
  }

  for (const arrow of arrows) {
    const bound = bindingsByArrow.get(arrow.id);
    const startId =
      bound?.start ?? legacyTerminalShapeId(arrow.props, "start");
    const endId = bound?.end ?? legacyTerminalShapeId(arrow.props, "end");
    const fromLabel = startId
      ? (labelById.get(startId) ?? "(unlabeled)")
      : "(point)";
    const toLabel = endId
      ? (labelById.get(endId) ?? "(unlabeled)")
      : "(point)";
    if (fromLabel === "(point)" && toLabel === "(point)") {
      // A floating arrow with no bindings tells the agent nothing.
      continue;
    }
    const arrowLabel = extractShapeLabel(arrow);
    buckets.connections.push({
      from: clamp(fromLabel, 80),
      to: clamp(toLabel, 80),
      label: arrowLabel ? clamp(arrowLabel, 80) : undefined,
    });
  }

  return buckets;
}

/* ─── Section rendering ─────────────────────────────────── */

function renderSections(buckets: Buckets): string[] {
  const sections: string[] = [];

  if (buckets.totalShapes === 0) {
    sections.push("(empty board — no shapes)");
    return sections;
  }

  if (buckets.frames.length > 0) {
    sections.push(
      `## Frames\n${buckets.frames.map((n) => `- ${quote(n)}`).join("\n")}`,
    );
  }
  if (buckets.sticky.length > 0) {
    sections.push(
      `## Sticky notes\n${buckets.sticky
        .map((n) => `- ${quote(n)}`)
        .join("\n")}`,
    );
  }
  if (buckets.text.length > 0) {
    sections.push(
      `## Text labels\n${buckets.text.map((n) => `- ${quote(n)}`).join("\n")}`,
    );
  }
  if (buckets.geo.length > 0) {
    sections.push(
      `## Geo shapes (with labels)\n${buckets.geo
        .map(({ kind, label }) => `- ${kind}: ${quote(label)}`)
        .join("\n")}`,
    );
  }
  if (buckets.markdownCards.length > 0) {
    const cards = buckets.markdownCards
      .map(
        (c) =>
          `### ${quote(c.name)} (markdown-card)\n${fence("md", c.body)}`,
      )
      .join("\n\n");
    sections.push(`## Markdown cards\n${cards}`);
  }
  if (buckets.mermaidCards.length > 0) {
    const cards = buckets.mermaidCards
      .map(
        (c) =>
          `### kind: ${quote(c.kind)}\n${fence("mermaid", c.body)}`,
      )
      .join("\n\n");
    sections.push(`## Mermaid cards\n${cards}`);
  }
  if (buckets.connections.length > 0) {
    const lines = buckets.connections
      .map(({ from, to, label }) => {
        const arrow = `${quote(from)} → ${quote(to)}`;
        return label ? `- ${arrow} (label: ${quote(label)})` : `- ${arrow}`;
      })
      .join("\n");
    sections.push(`## Connections (arrows)\n${lines}`);
  }

  if (buckets.truncationNotes.length > 0) {
    sections.push(buckets.truncationNotes.join("\n"));
  }

  return sections;
}

/* ─── Truncation helpers ────────────────────────────────── */

function dropTail<T>(arr: T[], label: string) {
  if (arr.length <= 1) return;
  const keep = Math.ceil(arr.length / 2);
  const dropped = arr.length - keep;
  arr.length = keep;
  // Stash a one-line note we'll surface in the rendered output.
  return dropped > 0
    ? `[truncated: ${dropped} more ${label}${dropped === 1 ? "" : "s"}]`
    : null;
}

function dropAll<T>(arr: T[], label: string) {
  const dropped = arr.length;
  if (dropped === 0) return null;
  arr.length = 0;
  return `[truncated: ${dropped} ${label}${dropped === 1 ? "" : "s"} omitted]`;
}

/* ─── Shape label extraction ────────────────────────────── */

/**
 * Best-effort plain-text label for a shape. Tries `props.text`
 * (legacy / sticky / geo / arrow text), then `props.name` (frame
 * title), then `props.richText` (newer tldraw — ProseMirror JSON).
 */
function extractShapeLabel(shape: RawShape): string | null {
  const props = shape.props ?? {};
  const text = pickString(props, "text");
  if (text && text.trim()) return collapseWhitespace(text);
  const name = pickString(props, "name");
  if (name && name.trim()) return collapseWhitespace(name);
  const rich = props.richText;
  if (rich) {
    const flat = flattenRichText(rich);
    if (flat) return collapseWhitespace(flat);
  }
  return null;
}

/**
 * Walk a ProseMirror JSON document and collect every `text` leaf,
 * separating block-level nodes with newlines. Robust to deeply
 * nested marks/decorations because we only care about the `text`
 * field on text nodes.
 */
function flattenRichText(input: unknown): string {
  const lines: string[] = [];
  let current = "";
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      current += obj.text;
      return;
    }
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) visit(child);
      // Treat known block types as line breaks.
      const t = obj.type;
      if (
        t === "paragraph" ||
        t === "heading" ||
        t === "listItem" ||
        t === "blockquote"
      ) {
        if (current.trim()) lines.push(current.trim());
        current = "";
      }
    }
  }
  visit(input);
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n").trim();
}

/* ─── Misc helpers ──────────────────────────────────────── */

function pickString(
  props: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!props) return undefined;
  const v = props[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Older tldraw snapshots stored arrow endpoints inline, e.g.
 * `props.start = { type: "binding", boundShapeId: "shape:abc", … }`.
 * We pull the `boundShapeId` out if present.
 */
function legacyTerminalShapeId(
  props: Record<string, unknown> | undefined,
  side: "start" | "end",
): string | undefined {
  const term = props?.[side];
  if (!term || typeof term !== "object") return undefined;
  const bsi = (term as Record<string, unknown>).boundShapeId;
  return typeof bsi === "string" ? bsi : undefined;
}

function firstHeading(md: string): string | null {
  // Pull the first `# heading` line if any; otherwise the first
  // non-empty line. Both make a fine "name" for the card.
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
  }
  for (const line of lines) {
    if (line.trim()) return line.trim().slice(0, 80);
  }
  return null;
}

function fence(lang: string, body: string): string {
  // Use `~~~` fences instead of triple-backtick: markdown specs
  // pasted on a whiteboard frequently contain triple-backtick code
  // blocks of their own, and `~~~` cleanly nests around them. We
  // still adapt the run length when a body happens to include `~~~`.
  let runs = 3;
  const matches = body.match(/~{3,}/g);
  if (matches) {
    for (const m of matches) runs = Math.max(runs, m.length + 1);
  }
  const fenceMarker = "~".repeat(runs);
  return `${fenceMarker}${lang}\n${body}\n${fenceMarker}`;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function byteLength(s: string): number {
  // Character length is a fine proxy here — we're not encoding for
  // a wire format, just budgeting a soft cap. (Avoids pulling
  // TextEncoder on every render.)
  return s.length;
}

function formatAgo(input: Date | string): string | null {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
