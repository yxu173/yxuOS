import { relations } from "drizzle-orm";

import { activityLog } from "./activity-log";
import { attachments } from "./attachments";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
} from "./auth";
import { boardFolders } from "./board-folders";
import { boardVersions } from "./board-versions";
import { boards } from "./boards";
import { comments } from "./comments";
import { designAssets } from "./design-assets";
import { designComponents } from "./design-components";
import { designFolders } from "./design-folders";
import { designs } from "./designs";
import { projects } from "./projects";
import { researchNotes } from "./research-notes";
import { taskBoards } from "./task-boards";
import { taskPlanRows, taskPlans } from "./task-plans";
import { tasks } from "./tasks";
import { teamDesignTokens } from "./team-design-tokens";

/**
 * Drizzle relations registry.
 *
 * Centralized so we don't run into circular imports between table files; each
 * relation set references tables that are already declared elsewhere in the
 * schema barrel.
 */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  boards: many(boards),
  designs: many(designs),
  designComponents: many(designComponents),
  designAssets: many(designAssets),
  comments: many(comments),
  activityRows: many(activityLog),
  createdTasks: many(tasks, { relationName: "task_creator" }),
  assignedTasks: many(tasks, { relationName: "task_assignee" }),
  attachments: many(attachments),
  boardVersions: many(boardVersions),
  // Better Auth organization plugin
  members: many(member),
  invitations: many(invitation),
}));

export const organizationRelations = relations(
  organization,
  ({ many, one }) => ({
    members: many(member),
    invitations: many(invitation),
    comments: many(comments),
    activityRows: many(activityLog),
    tasks: many(tasks),
    attachments: many(attachments),
    projects: many(projects),
    designTokens: one(teamDesignTokens),
  }),
);

export const teamDesignTokensRelations = relations(
  teamDesignTokens,
  ({ one }) => ({
    team: one(organization, {
      fields: [teamDesignTokens.teamId],
      references: [organization.id],
    }),
  }),
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(organization, {
    fields: [projects.teamId],
    references: [organization.id],
  }),
  boards: many(boards),
  designs: many(designs),
  tasks: many(tasks),
  designComponents: many(designComponents),
  designAssets: many(designAssets),
  attachments: many(attachments),
  boardFolders: many(boardFolders),
  designFolders: many(designFolders),
  taskBoards: many(taskBoards),
  researchNotes: many(researchNotes),
  taskPlans: many(taskPlans),
}));

export const researchNotesRelations = relations(
  researchNotes,
  ({ one, many }) => ({
    team: one(organization, {
      fields: [researchNotes.teamId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [researchNotes.projectId],
      references: [projects.id],
    }),
    author: one(user, {
      fields: [researchNotes.authorId],
      references: [user.id],
    }),
    // Plans handed off from this note. The fk lives on `task_plans`
    // (sourceNoteId), so the note is the parent here.
    derivedPlans: many(taskPlans),
  }),
);

export const taskPlansRelations = relations(taskPlans, ({ one, many }) => ({
  team: one(organization, {
    fields: [taskPlans.teamId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [taskPlans.projectId],
    references: [projects.id],
  }),
  author: one(user, {
    fields: [taskPlans.authorId],
    references: [user.id],
  }),
  sourceNote: one(researchNotes, {
    fields: [taskPlans.sourceNoteId],
    references: [researchNotes.id],
  }),
  rows: many(taskPlanRows),
}));

export const taskPlanRowsRelations = relations(taskPlanRows, ({ one }) => ({
  plan: one(taskPlans, {
    fields: [taskPlanRows.planId],
    references: [taskPlans.id],
  }),
  assignee: one(user, {
    fields: [taskPlanRows.assigneeId],
    references: [user.id],
  }),
  createdTask: one(tasks, {
    fields: [taskPlanRows.createdTaskId],
    references: [tasks.id],
  }),
}));

export const taskBoardsRelations = relations(taskBoards, ({ one, many }) => ({
  project: one(projects, {
    fields: [taskBoards.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const boardFoldersRelations = relations(
  boardFolders,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [boardFolders.projectId],
      references: [projects.id],
    }),
    parent: one(boardFolders, {
      fields: [boardFolders.parentFolderId],
      references: [boardFolders.id],
      relationName: "board_folder_parent",
    }),
    children: many(boardFolders, { relationName: "board_folder_parent" }),
    boards: many(boards),
  }),
);

export const designFoldersRelations = relations(
  designFolders,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [designFolders.projectId],
      references: [projects.id],
    }),
    parent: one(designFolders, {
      fields: [designFolders.parentFolderId],
      references: [designFolders.id],
      relationName: "design_folder_parent",
    }),
    children: many(designFolders, {
      relationName: "design_folder_parent",
    }),
    designs: many(designs),
  }),
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  team: one(organization, {
    fields: [attachments.teamId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [attachments.projectId],
    references: [projects.id],
  }),
  uploader: one(user, {
    fields: [attachments.uploaderId],
    references: [user.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  team: one(organization, {
    fields: [tasks.teamId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  taskBoard: one(taskBoards, {
    fields: [tasks.taskBoardId],
    references: [taskBoards.id],
  }),
  creator: one(user, {
    fields: [tasks.creatorId],
    references: [user.id],
    relationName: "task_creator",
  }),
  assignee: one(user, {
    fields: [tasks.assigneeId],
    references: [user.id],
    relationName: "task_assignee",
  }),
  // Self-relation for subtasks. Drizzle doesn't auto-pair self-relations
  // so name them explicitly.
  parent: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: "task_parent",
  }),
  subtasks: many(tasks, { relationName: "task_parent" }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(user, {
    fields: [comments.authorId],
    references: [user.id],
  }),
  team: one(organization, {
    fields: [comments.teamId],
    references: [organization.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  actor: one(user, {
    fields: [activityLog.actorId],
    references: [user.id],
  }),
  team: one(organization, {
    fields: [activityLog.teamId],
    references: [organization.id],
  }),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const designAssetsRelations = relations(designAssets, ({ one }) => ({
  owner: one(user, {
    fields: [designAssets.ownerId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [designAssets.projectId],
    references: [projects.id],
  }),
}));

export const designComponentsRelations = relations(
  designComponents,
  ({ one }) => ({
    owner: one(user, {
      fields: [designComponents.ownerId],
      references: [user.id],
    }),
    project: one(projects, {
      fields: [designComponents.projectId],
      references: [projects.id],
    }),
  }),
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  owner: one(user, {
    fields: [boards.ownerId],
    references: [user.id],
    relationName: "board_owner",
  }),
  project: one(projects, {
    fields: [boards.projectId],
    references: [projects.id],
  }),
  folder: one(boardFolders, {
    fields: [boards.folderId],
    references: [boardFolders.id],
  }),
  lockedBy: one(user, {
    fields: [boards.lockedById],
    references: [user.id],
    relationName: "board_locked_by",
  }),
  versions: many(boardVersions),
}));

export const boardVersionsRelations = relations(boardVersions, ({ one }) => ({
  board: one(boards, {
    fields: [boardVersions.boardId],
    references: [boards.id],
  }),
  editedBy: one(user, {
    fields: [boardVersions.editedById],
    references: [user.id],
  }),
}));

export const designsRelations = relations(designs, ({ one }) => ({
  owner: one(user, {
    fields: [designs.ownerId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [designs.projectId],
    references: [projects.id],
  }),
  folder: one(designFolders, {
    fields: [designs.folderId],
    references: [designFolders.id],
  }),
}));
