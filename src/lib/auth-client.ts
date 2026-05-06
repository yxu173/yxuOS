"use client";

import {
  organizationClient,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * `baseURL` is inferred from `window.location` when omitted — set
 * `NEXT_PUBLIC_APP_URL` and pass it explicitly here once the app moves
 * to a domain other than `localhost`.
 *
 * Plugins:
 *  - `organizationClient` exposes `authClient.organization.*` (create /
 *    list / setActive / getFullOrganization / inviteMember / etc.) and
 *    reactive hooks `useListOrganizations` and `useActiveOrganization`.
 *  - `usernameClient` exposes `authClient.signIn.username` and the
 *    `isUsernameAvailable` helper for the sign-up form.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient(), usernameClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
