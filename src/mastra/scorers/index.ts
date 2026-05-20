/**
 * Scorer registry.
 *
 * Each scorer evaluates a completed agent turn asynchronously and writes a
 * row into Mastra's `scores` table. We use them for two things:
 *
 * 1. **Prompt-iteration evidence.** Weekly we sample the lowest-scoring
 *    runs per agent, hand the transcript + scores to a prompt-critic
 *    model, and get diff suggestions for the agent instructions.
 * 2. **Behaviour drift detection.** A sudden tail of poor playbook-
 *    compliance scores after a deploy means a prompt regression.
 *
 * Scorers run on every turn; their `sampling` config (set on the agent's
 * `scorers` field) keeps cost manageable.
 */

export { toolEconomyScorer } from "./tool-economy";
export { playbookComplianceScorer } from "./playbook-compliance";
export { auditPassScorer } from "./audit-pass";

import { toolEconomyScorer } from "./tool-economy";
import { playbookComplianceScorer } from "./playbook-compliance";
import { auditPassScorer } from "./audit-pass";

/**
 * All scorers we register with the top-level `Mastra` instance. Agents
 * opt-in individually via their `scorers` field and supply their own
 * sampling rates.
 */
export const scorers = {
  tool_economy: toolEconomyScorer,
  playbook_compliance: playbookComplianceScorer,
  audit_pass: auditPassScorer,
};
