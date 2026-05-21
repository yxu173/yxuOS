import { Workspace, LocalFilesystem } from "@mastra/core/workspace";

/**
 * Mastra workspace for the design agent and other agents that need
 * filesystem access and skill discovery.
 *
 * Skills are discovered from:
 *   - `skills/`          — project-level skills (design-taste-frontend, redesign-existing-projects)
 *   - `.agent-skills/`   — additional agent skill bundles (backward compat)
 */
export const workspace = new Workspace({
  id: "yxuos-workspace",
  name: "yxuOS Workspace",
  filesystem: new LocalFilesystem({
    basePath: process.cwd(),
    contained: true,
  }),
  skills: ["skills", ".agent-skills"],
  checkSkillFileMtime: true,
});
