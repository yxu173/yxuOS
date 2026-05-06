import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { boards } from "./boards";

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
}));

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
}));
