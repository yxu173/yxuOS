import { createScorer } from "@mastra/core/evals";

import { flattenToolCalls, runLengthEncodeCalls, clamp01 } from "./_helpers";

/**
 * Tool-economy scorer.
 *
 * Penalises the agent for breaking work into too many sequential calls of
 * the same tool when a batched call exists. The board prompt is explicit:
 * "Don't make N `add_shapes` calls. One batched call." — but without a
 * scorer enforcing it we have no signal that the rule's actually being
 * followed turn-to-turn.
 *
 * Heuristic: for each consecutive run of the same tool with `count >= 2`
 * in a tool family that has a documented batch alternative, dock the score
 * proportionally. Runs of length 1 are always free; one-off calls aren't a
 * smell.
 *
 * The output is a single 0-1 number where 1 = perfectly batched, 0 = every
 * call was a duplicate of the previous one. We mostly care about the
 * gradient (turn-over-turn) rather than the absolute value, so the exact
 * shape of the penalty matters less than its monotonicity.
 */

const BATCHABLE_TOOLS: Record<string, string> = {
  add_shapes: "add_shapes (batch all shapes in one call)",
  connect_shapes: "connect_many (batch multiple arrows)",
  add_nodes: "add_nodes (batch sibling nodes)",
  patch_node: "patch_nodes (batch updates across nodes)",
  update_shapes: "update_shapes (batch the id array)",
  delete_shapes: "delete_shapes (batch the id array)",
  delete_nodes: "delete_nodes (batch the id array)",
};

export const toolEconomyScorer = createScorer({
  id: "tool_economy",
  description:
    "Penalises sequential repeats of tools that have a documented batched form.",
  type: "trajectory" as const,
})
  .generateScore(({ run }) => {
    const calls = flattenToolCalls(run.output);
    if (calls.length === 0) return 1;

    const runs = runLengthEncodeCalls(calls);
    let penalty = 0;
    let batchableCallCount = 0;

    for (const r of runs) {
      if (!BATCHABLE_TOOLS[r.name]) continue;
      batchableCallCount += r.count;
      if (r.count <= 1) continue;
      penalty += (r.count - 1) * 0.15;
    }

    if (batchableCallCount === 0) return 1;
    return clamp01(1 - penalty);
  })
  .generateReason(({ score, run }) => {
    const calls = flattenToolCalls(run.output);
    const runs = runLengthEncodeCalls(calls);
    const offenders = runs.filter(
      (r) => BATCHABLE_TOOLS[r.name] && r.count > 1,
    );

    if (offenders.length === 0) {
      return `Score ${score.toFixed(2)}: no redundant sequential tool runs detected.`;
    }

    const lines = offenders
      .map((r) => `  - ${r.name} × ${r.count} → ${BATCHABLE_TOOLS[r.name]}`)
      .join("\n");
    return `Score ${score.toFixed(2)}: detected batchable runs that should have been collapsed:\n${lines}`;
  });
