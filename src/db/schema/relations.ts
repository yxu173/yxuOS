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
import { boards } from "./boards";
import { comments } from "./comments";
import { designAssets } from "./design-assets";
import { designComponents } from "./design-components";
import { designs } from "./designs";
import { projects } from "./projects";
import { tasks } from "./tasks";

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
  // Better Auth organization plugin
  members: many(member),
  invitations: many(invitation),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  comments: many(comments),
  activityRows: many(activityLog),
  tasks: many(tasks),
  attachments: many(attachments),
  projects: many(projects),
}));

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
}));

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

export const boardsRelations = relations(boards, ({ one }) => ({
  owner: one(user, {
    fields: [boards.ownerId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [boards.projectId],
    references: [projects.id],
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
}));
