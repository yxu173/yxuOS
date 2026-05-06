import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import * as schema from "@/db/schema";

import { env } from "./env";

/**
 * Better Auth server instance.
 *
 * Plugins:
 *  - organization: teams (with member + invitation tables, role-based access).
 *    Built-in roles owner / admin / member are exactly what we ship with.
 *  - username: adds username + displayUsername to the user table so owners
 *    can add teammates by handle (no email invitation flow yet).
 *  - nextCookies (must stay LAST): intercepts Set-Cookie headers from
 *    earlier plugins and forwards them through Next.js.
 *
 * Personal teams: every new user gets an auto-created "Personal" team and
 * is added as its owner via `databaseHooks.user.create.after`. The session
 * create hook sets `activeOrganizationId` to the user's first team so the
 * UI always has an active workspace.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },

  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // Auto-create a "Personal" team for every new user and add them
          // as the owner. We do this directly via Drizzle (not the org
          // plugin's API) so we don't need session headers — the hook
          // runs server-side without a logged-in session yet.
          const orgId = nanoid();
          const memberId = nanoid();
          const now = new Date();
          const baseSlug = `personal-${createdUser.id.slice(0, 12)}`.toLowerCase();
          await db.insert(schema.organization).values({
            id: orgId,
            name: "Personal",
            slug: baseSlug,
            createdAt: now,
          });
          await db.insert(schema.member).values({
            id: memberId,
            organizationId: orgId,
            userId: createdUser.id,
            role: "owner",
            createdAt: now,
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Set the user's first organization as the active one so the UI
          // always has a workspace context immediately after sign-in.
          const firstMember = await db.query.member.findFirst({
            where: eq(schema.member.userId, session.userId),
            columns: { organizationId: true },
          });
          if (firstMember) {
            return {
              data: {
                ...session,
                activeOrganizationId: firstMember.organizationId,
              },
            };
          }
          return { data: session };
        },
      },
    },
  },

  plugins: [
    organization(),
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type User = Session["user"];
