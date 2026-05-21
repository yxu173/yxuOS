/**
 * Visualization tools — table, bar chart, mindmap, org chart, timeline,
 * Venn diagram.
 *
 * Each function follows the same contract as the canvas tools in
 * `canvas-tools.ts`: receive the Excalidraw API + a typed input,
 * build element skeletons, convert, update the scene, and return a
 * `ToolResult`.
 */

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { fail, ok, type ToolResult } from "@/lib/tool-result";

/* ─── colour palette ──────────────────────────────────── */

const COLORS = [
  { stroke: "#5e81f4", bg: "#5e81f41a" }, // blue
  { stroke: "#4ade80", bg: "#4ade801a" }, // green
  { stroke: "#f87171", bg: "#f871711a" }, // red
  { stroke: "#fb923c", bg: "#fb923c1a" }, // orange
  { stroke: "#c084fc", bg: "#c084fc1a" }, // violet
  { stroke: "#38bdf8", bg: "#38bdf81a" }, // light-blue
  { stroke: "#facc15", bg: "#facc151a" }, // yellow
  { stroke: "#e879f9", bg: "#e879f91a" }, // pink
];

function pickColor(index: number) {
  return COLORS[index % COLORS.length];
}

/* ─── shared skeleton builders ────────────────────────── */

const CELL_W = 140;
const CELL_H = 36;
const CELL_FONT = 14;
const HEADER_BG = "#1e293b";
const CELL_BG = "#0f172a";
const LINE_COLOR = "#334155";
const LABEL_FONT = 14;

function cellSkeleton(x: number, y: number, text: string, header: boolean) {
  return {
    type: "rectangle" as const,
    x,
    y,
    width: CELL_W,
    height: CELL_H,
    strokeColor: LINE_COLOR,
    backgroundColor: header ? HEADER_BG : CELL_BG,
    fillStyle: "solid" as const,
    strokeWidth: 1,
    label: { text, fontSize: CELL_FONT },
  };
}

function textSkeleton(x: number, y: number, text: string, fontSize = LABEL_FONT) {
  return {
    type: "text" as const,
    x,
    y,
    text,
    fontSize,
    strokeColor: "#94a3b8",
  };
}

function rectSkeleton(
  x: number,
  y: number,
  w: number,
  h: number,
  color: (typeof COLORS)[number],
  label?: string,
) {
  return {
    type: "rectangle" as const,
    x,
    y,
    width: w,
    height: h,
    strokeColor: color.stroke,
    backgroundColor: color.bg,
    fillStyle: "solid" as const,
    strokeWidth: 2,
    roundness: { type: 3 as const },
    ...(label ? { label: { text: label, fontSize: 13 } } : {}),
  };
}

function ellipseSkeleton(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (typeof COLORS)[number],
  label?: string,
) {
  return {
    type: "ellipse" as const,
    x: cx - rx,
    y: cy - ry,
    width: rx * 2,
    height: ry * 2,
    strokeColor: color.stroke,
    backgroundColor: color.bg,
    fillStyle: "solid" as const,
    strokeWidth: 2,
    ...(label ? { label: { text: label, fontSize: 13 } } : {}),
  };
}

function arrowSkeleton(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = "#64748b",
  label?: string,
) {
  return {
    type: "arrow" as const,
    x: ax,
    y: ay,
    strokeColor: color,
    strokeWidth: 1.5,
    endArrowhead: "arrow" as const,
    points: [[0, 0], [bx - ax, by - ay]] as [number, number][],
    ...(label ? { label: { text: label, fontSize: 12 } } : {}),
  };
}

/* ─── 1. Table ─────────────────────────────────────────── */

export interface AddTableInput {
  caption?: string;
  header: string[];
  rows: string[][];
  x?: number;
  y?: number;
}

export function executeAddTable(
  api: ExcalidrawImperativeAPI,
  input: AddTableInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const originX = input.x ?? 0;
    const originY = input.y ?? 0;
    const colCount = input.header.length;
    const rowCount = input.rows.length + 1; // + header row
    const totalW = colCount * CELL_W;
    const totalH = rowCount * CELL_H;

    const skeletons: Record<string, unknown>[] = [];

    // Group frame (optional caption)
    if (input.caption) {
      skeletons.push({
        type: "frame" as const,
        x: originX - 12,
        y: originY - 28,
        width: totalW + 24,
        height: totalH + 40,
        name: input.caption,
        children: [],
      });
    }

    // Header row
    for (let c = 0; c < colCount; c++) {
      skeletons.push(cellSkeleton(originX + c * CELL_W, originY, input.header[c], true));
    }

    // Data rows
    for (let r = 0; r < input.rows.length; r++) {
      const y = originY + (r + 1) * CELL_H;
      for (let c = 0; c < colCount; c++) {
        const text = input.rows[r][c] ?? "";
        skeletons.push(cellSkeleton(originX + c * CELL_W, y, text, false));
      }
    }

    const created = convertToExcalidrawElements(skeletons as Parameters<typeof convertToExcalidrawElements>[0]);
    const ids = created.map((el) => el.id);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: ids });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_table failed");
  }
}

/* ─── 2. Bar chart ─────────────────────────────────────── */

const BAR_MAX_H = 200;
const BAR_W = 40;
const BAR_GAP = 16;

export interface AddBarChartInput {
  caption?: string;
  labels: string[];
  values: number[];
  x?: number;
  y?: number;
  color?: string;
}

export function executeAddBarChart(
  api: ExcalidrawImperativeAPI,
  input: AddBarChartInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const n = input.labels.length;
    const originX = input.x ?? 0;
    const originY = input.y ?? 0;
    const maxVal = Math.max(1, ...input.values);
    const chartH = BAR_MAX_H + 30; // bars + axis space

    const skeletons: Record<string, unknown>[] = [];
    const colorObj = pickColor(input.color ? COLORS.findIndex((c) => c.stroke === input.color) % COLORS.length : 0);

    // Frame
    if (input.caption) {
      skeletons.push({
        type: "frame",
        x: originX - 12,
        y: originY - 28,
        width: n * (BAR_W + BAR_GAP) + 40,
        height: chartH + 48,
        name: input.caption,
        children: [],
      });
    }

    // Baseline (horizontal line)
    const baseY = originY + BAR_MAX_H;
    skeletons.push({
      type: "line",
      x: originX,
      y: baseY,
      width: n * (BAR_W + BAR_GAP) + 10,
      height: 0,
      strokeColor: LINE_COLOR,
      strokeWidth: 1,
      points: [
        [0, 0],
        [n * (BAR_W + BAR_GAP) + 10, 0],
      ],
    });

    // Bars + labels
    for (let i = 0; i < n; i++) {
      const barH = Math.max(4, (input.values[i] / maxVal) * BAR_MAX_H);
      const bx = originX + i * (BAR_W + BAR_GAP);
      const by = baseY - barH;

      skeletons.push(rectSkeleton(bx, by, BAR_W, barH, colorObj));

      // Value label on top
      skeletons.push({
        type: "text",
        x: bx,
        y: by - 18,
        text: String(input.values[i]),
        fontSize: 11,
        strokeColor: "#94a3b8",
      });

      // Axis label
      skeletons.push({
        type: "text",
        x: bx,
        y: baseY + 8,
        text: input.labels[i],
        fontSize: 12,
        strokeColor: "#64748b",
      });
    }

    const created = convertToExcalidrawElements(skeletons as Parameters<typeof convertToExcalidrawElements>[0]);
    const ids = created.map((el) => el.id);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: ids });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_bar_chart failed");
  }
}

/* ─── 3. Mindmap ───────────────────────────────────────── */

interface MindmapNode {
  text: string;
  children: MindmapNode[];
}

function parseMindmapText(text: string): MindmapNode | null {
  const lines = text
    .split("\n")
    .map((l) => ({ indent: l.search(/\S/), text: l.trim() }))
    .filter((l) => l.text !== "");
  if (lines.length === 0) return null;

  const root: MindmapNode = { text: lines[0].text, children: [] };
   
  const stack: { node: MindmapNode; indent: number }[] = [{ node: root, indent: lines[0].indent }];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    while (stack.length > 1 && stack[stack.length - 1].indent >= line.indent) {
      stack.pop();
    }
    const child: MindmapNode = { text: line.text, children: [] };
    stack[stack.length - 1].node.children.push(child);
    stack.push({ node: child, indent: line.indent });
  }
  return root;
}

const NODE_W = 120;
const NODE_H = 36;
const RADIUS_STEP = 160;

function layoutRadial(
  node: MindmapNode,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  level: number,
): { shapes: Record<string, unknown>[]; edges: { from: { x: number; y: number }; to: { x: number; y: number }; label?: string }[] } {
  const shapes: Record<string, unknown>[] = [];
  const edges: { from: { x: number; y: number }; to: { x: number; y: number }; label?: string }[] = [];

  shapes.push({
    type: "rectangle",
    x: cx - NODE_W / 2,
    y: cy - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
    strokeColor: "#5e81f4",
    backgroundColor: "#5e81f41a",
    fillStyle: "solid",
    strokeWidth: 2,
    roundness: { type: 3 },
    label: { text: node.text, fontSize: 13 },
  });

  const children = node.children;
  if (children.length === 0) return { shapes, edges };

  const childRadius = radius + RADIUS_STEP;
  const span = endAngle - startAngle;
  for (let i = 0; i < children.length; i++) {
    const frac = children.length === 1 ? 0.5 : (i + 0.5) / children.length;
    const angle = startAngle + frac * span;
    const childCx = cx + childRadius * Math.cos(angle);
    const childCy = cy + childRadius * Math.sin(angle);

    // Edge from parent edge to child
    const px = cx + (NODE_W / 2 + 8) * Math.cos(angle);
    const py = cy + (NODE_H / 2 + 8) * Math.sin(angle);
    const qx = childCx - (NODE_W / 2 + 8) * Math.cos(angle);
    const qy = childCy - (NODE_H / 2 + 8) * Math.sin(angle);
    edges.push({ from: { x: px, y: py }, to: { x: qx, y: qy } });

    const childSpan = span / children.length;
    const childResult = layoutRadial(
      children[i],
      childCx,
      childCy,
      childRadius,
      angle - childSpan * 0.4,
      angle + childSpan * 0.4,
      level + 1,
    );
    shapes.push(...childResult.shapes);
    edges.push(...childResult.edges);
  }

  return { shapes, edges };
}

export interface AddMindmapInput {
  text: string;
  x?: number;
  y?: number;
}

export function executeAddMindmap(
  api: ExcalidrawImperativeAPI,
  input: AddMindmapInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const root = parseMindmapText(input.text);
    if (!root) return fail("invalid_input", "Failed to parse mindmap text.");

    const cx = input.x ?? 400;
    const cy = input.y ?? 300;
    const { shapes, edges } = layoutRadial(root, cx, cy, 0, 0, Math.PI * 2, 0);

    // Add edge arrows to skeletons
    for (const edge of edges) {
      shapes.push(arrowSkeleton(edge.from.x, edge.from.y, edge.to.x, edge.to.y));
    }

    const created = convertToExcalidrawElements(shapes as Parameters<typeof convertToExcalidrawElements>[0]);
    const ids = created.map((el) => el.id);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: ids });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_mindmap failed");
  }
}

/* ─── 4. Org chart ─────────────────────────────────────── */

interface OrgNode {
  name: string;
  role?: string;
  children: OrgNode[];
}

interface RawOrgNode {
  name: string;
  role?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOrgchartData(data: any): OrgNode | null {
  const obj = Array.isArray(data) ? data[0] : data;
  if (!obj || typeof obj !== "object" || !obj.name) return null;

  function convert(node: RawOrgNode): OrgNode {
    return {
      name: node.name,
      role: node.role,
      children: (node.children ?? []).map(convert),
    };
  }
  return convert(obj as RawOrgNode);
}

const ORG_W = 150;
const ORG_H = 48;
const ORG_VGAP = 40;
const ORG_HGAP = 30;

function layoutOrg(
  node: OrgNode,
  x: number,
  y: number,
): { shapes: Record<string, unknown>[]; edges: { from: { x: number; y: number }; to: { x: number; y: number } }[]; totalW: number } {
  const shapes: Record<string, unknown>[] = [];
  const edges: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  const color = pickColor(0);

  const label = node.role ? `${node.name} (${node.role})` : node.name;
  shapes.push(rectSkeleton(x, y, ORG_W, ORG_H, color, label));

  if (node.children.length === 0) return { shapes, edges, totalW: ORG_W };

  const childY = y + ORG_H + ORG_VGAP;
  let childX = x;
  let totalChildW = 0;

  for (const child of node.children) {
    const result = layoutOrg(child, childX, childY);
    shapes.push(...result.shapes);
    edges.push(...result.edges);

    // Edge from parent bottom-center to child top-center
    const px = x + ORG_W / 2;
    const py = y + ORG_H;
    const qx = childX + ORG_W / 2;
    const qy = childY;
    edges.push({ from: { x: px, y: py }, to: { x: qx, y: qy } });

    childX += result.totalW + ORG_HGAP;
    totalChildW += result.totalW + ORG_HGAP;
  }
  totalChildW -= ORG_HGAP; // remove trailing gap

  return { shapes, edges, totalW: Math.max(ORG_W, totalChildW) };
}

export interface AddOrgchartInput {
  tree: { name: string; role?: string; children?: { name: string; role?: string; children?: OrgNode[] }[] };
  x?: number;
  y?: number;
}

export function executeAddOrgchart(
  api: ExcalidrawImperativeAPI,
  input: AddOrgchartInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const root = parseOrgchartData(input.tree);
    if (!root) return fail("invalid_input", "Failed to parse org chart data.");

    const ox = input.x ?? 0;
    const oy = input.y ?? 0;
    const { shapes, edges } = layoutOrg(root, ox, oy);

    for (const edge of edges) {
      shapes.push(arrowSkeleton(edge.from.x, edge.from.y, edge.to.x, edge.to.y));
    }

    const created = convertToExcalidrawElements(shapes as Parameters<typeof convertToExcalidrawElements>[0]);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: created.map((el) => el.id) });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_orgchart failed");
  }
}

/* ─── 5. Timeline ──────────────────────────────────────── */

const TIMELINE_Y = 60;
const DOT_R = 5;
const LABEL_OFFSET = 22;

export interface AddTimelineInput {
  events: { date: string; label: string }[];
  x?: number;
  y?: number;
}

export function executeAddTimeline(
  api: ExcalidrawImperativeAPI,
  input: AddTimelineInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const originX = input.x ?? 0;
    const originY = input.y ?? 0;
    const spacing = Math.max(140, 800 / input.events.length);
    const lineW = (input.events.length - 1) * spacing + 40;

    const skeletons: Record<string, unknown>[] = [];

    // Main arrow line
    skeletons.push({
      type: "arrow",
      x: originX + 20,
      y: originY + TIMELINE_Y,
      strokeColor: "#5e81f4",
      strokeWidth: 2,
      endArrowhead: "arrow",
      points: [[0, 0], [lineW, 0]],
    });

    // Events — alternating above/below
    for (let i = 0; i < input.events.length; i++) {
      const ex = originX + 20 + i * spacing;
      const above = i % 2 === 0;
      const dotColor = pickColor(i);

      // Dot
      skeletons.push({
        type: "ellipse",
        x: ex - DOT_R,
        y: originY + TIMELINE_Y - DOT_R,
        width: DOT_R * 2,
        height: DOT_R * 2,
        strokeColor: dotColor.stroke,
        backgroundColor: dotColor.stroke,
        fillStyle: "solid",
        strokeWidth: 2,
      });

      // Connector line
      const connLen = above ? -30 : 30;
      skeletons.push({
        type: "arrow",
        x: ex,
        y: originY + TIMELINE_Y,
        strokeColor: LINE_COLOR,
        strokeWidth: 1,
        points: [[0, 0], [0, connLen]],
      });

      // Date label
      const labelY = above
        ? originY + TIMELINE_Y - 42
        : originY + TIMELINE_Y + 36;
      skeletons.push(textSkeleton(ex - 40, labelY, input.events[i].date, 10));

      // Event label
      const eventY = above
        ? originY + TIMELINE_Y - LABEL_OFFSET
        : originY + TIMELINE_Y + LABEL_OFFSET;
      skeletons.push(textSkeleton(ex - 50, eventY, input.events[i].label, 12));
    }

    const created = convertToExcalidrawElements(skeletons as Parameters<typeof convertToExcalidrawElements>[0]);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: created.map((el) => el.id) });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_timeline failed");
  }
}

/* ─── 6. Venn diagram ──────────────────────────────────── */

const VENN_R = 100;
const VENN_OVERLAP = 60;

export interface AddVennInput {
  caption?: string;
  sets: { label: string; color?: string }[];
  x?: number;
  y?: number;
}

export function executeAddVenn(
  api: ExcalidrawImperativeAPI,
  input: AddVennInput,
): ToolResult<{ createdIds: string[] }> {
  try {
    const ox = input.x ?? 0;
    const oy = input.y ?? 0;
    const n = input.sets.length;
    const skeletons: Record<string, unknown>[] = [];

    // Position circles in a chain with overlap
    for (let i = 0; i < n; i++) {
      const color = pickColor(i);
      const cx = ox + VENN_R + i * (VENN_R * 2 - VENN_OVERLAP);
      const cy = oy + VENN_R;

      skeletons.push(ellipseSkeleton(cx, cy, VENN_R, VENN_R, color, input.sets[i].label));
    }

    const totalW = VENN_R * 2 + (n - 1) * (VENN_R * 2 - VENN_OVERLAP);

    // Group frame
    if (input.caption) {
      skeletons.unshift({
        type: "frame",
        x: ox - 12,
        y: oy - 28,
        width: totalW + 24,
        height: VENN_R * 2 + 48,
        name: input.caption,
        children: [],
      });
    }

    const created = convertToExcalidrawElements(skeletons as Parameters<typeof convertToExcalidrawElements>[0]);
    api.updateScene({
      elements: [...api.getSceneElements(), ...created],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return ok({ createdIds: created.map((el) => el.id) });
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "add_venn failed");
  }
}
