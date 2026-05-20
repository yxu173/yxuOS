import { createScorer } from "@mastra/core/evals";

import { flattenToolCalls, clamp01 } from "./_helpers";

/**
 * Playbook-compliance scorer.
 *
 * The board and design agents' prompts encode ordered playbooks: e.g.
 * "Playbook A step 3 = find_free_space, step 5 = add_shapes". This
 * scorer checks the recorded tool sequence against a handful of
 * pattern-level invariants we care about most:
 *
 *  1. `add_shapes` should be preceded — somewhere earlier in the same
 *     turn — by `find_free_space` OR `query_canvas`. Drawing without
 *     reading state first is how diagrams end up overlapping.
 *  2. `add_artboard` (design) similarly should follow either
 *     `query_canvas` or `list_components` / `list_assets` — composing
 *     without checking the library is how the agent forgets reusable
 *     nav / footer components.
 *  3. After a large `add_shapes` (≥ 6 shapes in one call) the agent
 *     should call `analyze_canvas` or `audit_design` before the turn
 *     ends. Mandated by the prompt; this is the enforcement signal.
 *
 * Each invariant violation costs a flat 0.25 of the score; a turn that
 * trips every invariant lands at 0. Turns that don't use any of the
 * gated tools at all score 1 (nothing to comply with).
 */

interface ToolCall {
  toolName: string;
  args: Record<string, unknown> | undefined;
}

type Invariant = {
  id: string;
  applies: (calls: ToolCall[]) => boolean;
  satisfied: (calls: ToolCall[]) => boolean;
  message: string;
};

const INVARIANTS: Invariant[] = [
  {
    id: "add_shapes_after_read",
    applies: (calls) => calls.some((c) => c.toolName === "add_shapes"),
    satisfied: (calls) => {
      const addIdx = calls.findIndex((c) => c.toolName === "add_shapes");
      if (addIdx < 0) return true;
      return calls
        .slice(0, addIdx)
        .some(
          (c) => c.toolName === "find_free_space" || c.toolName === "query_canvas",
        );
    },
    message:
      "add_shapes was called before any find_free_space / query_canvas — placement was guessed",
  },
  {
    id: "add_artboard_after_library_read",
    applies: (calls) => calls.some((c) => c.toolName === "add_artboard"),
    satisfied: (calls) => {
      const addIdx = calls.findIndex((c) => c.toolName === "add_artboard");
      if (addIdx < 0) return true;
      return calls
        .slice(0, addIdx)
        .some(
          (c) =>
            c.toolName === "query_canvas" ||
            c.toolName === "list_components" ||
            c.toolName === "list_assets",
        );
    },
    message:
      "add_artboard was called without checking query_canvas / list_components / list_assets first",
  },
  {
    id: "audit_after_big_build",
    applies: (calls) =>
      calls.some(
        (c) => isBigAddShapes(c) || c.toolName === "add_artboard",
      ),
    satisfied: (calls) => {
      const lastBig = lastIndexOf(
        calls,
        (c) => isBigAddShapes(c) || c.toolName === "add_artboard",
      );
      if (lastBig < 0) return true;
      return calls
        .slice(lastBig + 1)
        .some(
          (c) =>
            c.toolName === "analyze_canvas" || c.toolName === "audit_design",
        );
    },
    message:
      "Big build (≥ 6 shapes or new artboard) was not followed by analyze_canvas / audit_design",
  },
];

function isBigAddShapes(call: ToolCall): boolean {
  if (call.toolName !== "add_shapes") return false;
  const shapes = (call.args as { shapes?: unknown[] } | undefined)?.shapes;
  return Array.isArray(shapes) && shapes.length >= 6;
}

function lastIndexOf<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}

export const playbookComplianceScorer = createScorer({
  id: "playbook_compliance",
  description:
    "Checks that the agent's tool sequence respects ordered playbook invariants (read before write, audit after big build).",
  type: "trajectory" as const,
})
  .generateScore(({ run }) => {
    const calls = flattenToolCalls(run.output).map((c) => ({
      toolName: c.toolName,
      args: c.args,
    }));

    const applicable = INVARIANTS.filter((inv) => inv.applies(calls));
    if (applicable.length === 0) return 1;

    const failures = applicable.filter((inv) => !inv.satisfied(calls));
    return clamp01(1 - failures.length * 0.25);
  })
  .generateReason(({ score, run }) => {
    const calls = flattenToolCalls(run.output).map((c) => ({
      toolName: c.toolName,
      args: c.args,
    }));
    const applicable = INVARIANTS.filter((inv) => inv.applies(calls));
    const failures = applicable.filter((inv) => !inv.satisfied(calls));

    if (failures.length === 0) {
      return `Score ${score.toFixed(2)}: every applicable playbook invariant was satisfied (${applicable.length} checked).`;
    }

    const lines = failures.map((f) => `  - ${f.id}: ${f.message}`).join("\n");
    return `Score ${score.toFixed(2)}: ${failures.length}/${applicable.length} invariants failed:\n${lines}`;
  });
