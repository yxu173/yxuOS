import { createScorer } from "@mastra/core/evals";

import { flattenToolCalls, clamp01 } from "./_helpers";

/**
 * Audit-pass scorer.
 *
 * Mirror of the prompt-level rule that says "after any non-trivial build,
 * audit it". Where `playbook-compliance` checks ordering, this scorer
 * inspects the audit's RESULT — counting the errors / warnings the audit
 * returned and rewarding turns where the agent both ran the audit and
 * fixed the issues (i.e. follow-up `patch_*` / `update_*` calls came
 * after the audit and before the turn ended).
 *
 * The output is structured so the reason string surfaces actionable info
 * back to the prompt-iteration loop: not just "you scored 0.6" but
 * "audit reported 4 errors and only 1 of them was patched before the
 * turn ended".
 */

interface ToolCall {
  toolName: string;
  args: Record<string, unknown> | undefined;
  result: Record<string, unknown> | undefined;
  index: number;
}

const AUDIT_TOOLS = new Set(["analyze_canvas", "audit_design"]);
const FIX_TOOLS = new Set([
  "update_shapes",
  "relabel_arrows",
  "align_shapes",
  "distribute_shapes",
  "layout_shapes",
  "delete_shapes",
  "patch_node",
  "patch_nodes",
  "delete_nodes",
  "move_nodes",
  "apply_theme",
  "set_tokens",
]);

function isAudit(call: ToolCall): boolean {
  return AUDIT_TOOLS.has(call.toolName);
}

function isFix(call: ToolCall): boolean {
  return FIX_TOOLS.has(call.toolName);
}

interface AuditIssueCounts {
  errors: number;
  warnings: number;
}

/**
 * The audit tools return an envelope-shaped result. We dig through both
 * shapes (board's `{ issues: [{ severity }] }` and design's
 * `{ findings: [{ severity }] }`) without coupling the scorer to either
 * concrete schema — if the shape evolves we just under-count, which is
 * the safe failure mode.
 */
function countIssues(call: ToolCall): AuditIssueCounts {
  const result = call.result as
    | { ok?: boolean; data?: { issues?: unknown[]; findings?: unknown[] } }
    | undefined;
  const data = result?.data;
  if (!data) return { errors: 0, warnings: 0 };

  const items = (data.issues ?? data.findings ?? []) as Array<{
    severity?: string;
  }>;
  let errors = 0;
  let warnings = 0;
  for (const item of items) {
    if (item?.severity === "error") errors += 1;
    else if (item?.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
}

export const auditPassScorer = createScorer({
  id: "audit_pass",
  description:
    "Rewards turns that ran an audit (analyze_canvas / audit_design) after building, and fixed issues the audit found.",
  type: "trajectory" as const,
})
  .generateScore(({ run }) => {
    const calls = flattenToolCalls(run.output);
    const audits = calls.filter(isAudit);

    if (audits.length === 0) {
      const builtSomething = calls.some((c) =>
        ["add_shapes", "add_artboard", "update_artboard"].includes(c.toolName),
      );
      return builtSomething ? 0 : 1;
    }

    const lastAudit = audits[audits.length - 1]!;
    const { errors, warnings } = countIssues(lastAudit);
    if (errors === 0 && warnings === 0) return 1;

    const fixCallsAfterAudit = calls
      .slice(lastAudit.index + 1)
      .filter(isFix).length;

    const issueWeight = errors * 2 + warnings;
    if (issueWeight === 0) return 1;

    const fixCoverage = Math.min(1, fixCallsAfterAudit / issueWeight);
    return clamp01(0.5 + 0.5 * fixCoverage);
  })
  .generateReason(({ score, run }) => {
    const calls = flattenToolCalls(run.output);
    const audits = calls.filter(isAudit);

    if (audits.length === 0) {
      return `Score ${score.toFixed(2)}: no audit tool was called this turn.`;
    }

    const lastAudit = audits[audits.length - 1]!;
    const { errors, warnings } = countIssues(lastAudit);
    const fixCallsAfterAudit = calls
      .slice(lastAudit.index + 1)
      .filter(isFix).length;

    return `Score ${score.toFixed(2)}: audit found ${errors} errors / ${warnings} warnings, followed by ${fixCallsAfterAudit} fix tool calls.`;
  });
