"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * `baseURL` is inferred from `window.location` when omitted — set
 * `NEXT_PUBLIC_APP_URL` and pass it explicitly here once the app moves
 * to a domain other than `localhost`.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
