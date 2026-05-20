/**
 * Shared helpers for trajectory-based scorers.
 *
 * Mastra runs scorers asynchronously after a turn completes and hands us a
 * `Trajectory` — the ordered list of tool calls / model generations / nested
 * sub-trajectories that produced the agent's response. The helpers below
 * flatten that tree into a single list of tool-call records and compute a
 * few summary stats that every scorer in this folder ends up needing.
 *
 * Keeping the flattening logic in one place avoids each scorer re-walking
 * the tree differently and producing inconsistent baselines.
 */

import type { Trajectory, TrajectoryStep } from "@mastra/core/evals";

export interface FlatToolCall {
  toolName: string;
  args: Record<string, unknown> | undefined;
  result: Record<string, unknown> | undefined;
  index: number;
}

/**
 * Walks a trajectory tree and returns every `tool_call` step in order,
 * indexed by their position in the flattened sequence.
 *
 * We deliberately collapse MCP tool calls and ordinary tool calls into the
 * same flat list — for the kind of "did the agent batch its work?" checks
 * the scorers do, the distinction doesn't matter.
 */
export function flattenToolCalls(trajectory: Trajectory | undefined): FlatToolCall[] {
  if (!trajectory?.steps?.length) return [];
  const out: FlatToolCall[] = [];

  const walk = (steps: TrajectoryStep[]) => {
    for (const step of steps) {
      if (step.stepType === "tool_call" || step.stepType === "mcp_tool_call") {
        out.push({
          toolName: step.name,
          args: (step as { toolArgs?: Record<string, unknown> }).toolArgs,
          result: (step as { toolResult?: Record<string, unknown> }).toolResult,
          index: out.length,
        });
      }
      if (step.children?.length) walk(step.children);
    }
  };

  walk(trajectory.steps);
  return out;
}

/**
 * Counts consecutive runs of the same tool. e.g. `[A, A, A, B, A, A]` →
 * `[{ name: "A", count: 3 }, { name: "B", count: 1 }, { name: "A", count: 2 }]`.
 * Used by the tool-economy scorer to detect "five sequential add_shapes
 * calls" patterns the prompt explicitly tells agents not to do.
 */
export function runLengthEncodeCalls(
  calls: FlatToolCall[],
): Array<{ name: string; count: number }> {
  if (!calls.length) return [];
  const runs: Array<{ name: string; count: number }> = [];
  for (const call of calls) {
    const tail = runs[runs.length - 1];
    if (tail && tail.name === call.toolName) tail.count += 1;
    else runs.push({ name: call.toolName, count: 1 });
  }
  return runs;
}

/**
 * Maps a 0-1 score into the inclusive `[0, 1]` range Mastra expects from
 * `generateScore`. Negative or NaN inputs collapse to 0; >1 to 1. Keeps
 * scorer math forgiving without silently swallowing real bugs (the clamp
 * is documented and only kicks in at boundaries).
 */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
