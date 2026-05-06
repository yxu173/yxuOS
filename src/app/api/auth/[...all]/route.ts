import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Better Auth catch-all handler.
 *
 * Mounts every Better Auth endpoint (`/sign-in`, `/sign-up`, `/get-session`,
 * provider callbacks, …) under `/api/auth/*`.
 */
export const { GET, POST } = toNextJsHandler(auth);
