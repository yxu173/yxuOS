/**
 * GitHub App authentication primitives.
 *
 * A GitHub App authenticates in two layers and the indexer needs both:
 *
 *   1. `mintAppJwt()` returns a short-lived RS256 JWT signed with the App's
 *      private key. Used only to call `POST /app/installations/:id/access_tokens`.
 *
 *   2. `mintInstallationToken()` exchanges that JWT for an installation token
 *      (1h lifetime, ~5000 req/h rate budget per installation). This is what
 *      every other GitHub API call uses as a bearer.
 *
 * We deliberately do NOT cache tokens in this module. Caching happens at the
 * `getInstallationToken(installationRowId)` layer (see Slice C), which reads/
 * writes the cached value on the `github_installations` row so every serverless
 * instance shares the same lease and we don't blow GitHub's "60 token mints
 * per installation per hour" budget.
 *
 * Private key format: we use `node:crypto.createPrivateKey()` which transparently
 * accepts PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`, the format GitHub emits
 * by default) and PKCS#8 (`-----BEGIN PRIVATE KEY-----`). No conversion needed.
 *
 * Deployment shapes for the key:
 *   - Local dev: multi-line PEM in double quotes in `.env.local`. dotenv v15+
 *     preserves the newlines.
 *   - Vercel: the dashboard mangles multi-line values, so we accept a base64
 *     fallback in `GITHUB_APP_PRIVATE_KEY_B64`. Loader prefers B64 when set.
 */

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

import { env } from "@/lib/env";

/** RS256 JWS header. Constant payload, so we can pre-encode it. */
const HEADER_B64URL = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
  "base64url",
);

let cachedKey: KeyObject | null = null;

/**
 * Resolve and parse the App's private key once. Subsequent calls return
 * the cached `KeyObject`. We try the base64 form first so Vercel-style
 * deployments don't fall back to a malformed multi-line PEM that was
 * mangled by the dashboard.
 */
function loadPrivateKey(): KeyObject {
  if (cachedKey) return cachedKey;

  const b64 = env.GITHUB_APP_PRIVATE_KEY_B64?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();

  let raw: string | undefined;
  if (b64) {
    try {
      raw = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      throw new Error(
        "GITHUB_APP_PRIVATE_KEY_B64 is set but does not decode as base64.",
      );
    }
  } else if (pem) {
    raw = pem;
  }

  if (!raw) {
    throw new Error(
      "GitHub App private key not configured. Set GITHUB_APP_PRIVATE_KEY (multi-line PEM) " +
        "or GITHUB_APP_PRIVATE_KEY_B64 (base64-encoded PEM).",
    );
  }

  // Sanity check before handing to crypto so the error is humane.
  if (!raw.includes("BEGIN") || !raw.includes("PRIVATE KEY")) {
    throw new Error(
      "GitHub App private key is malformed: expected a PEM block containing " +
        "'-----BEGIN [RSA] PRIVATE KEY-----'. If you pasted into the Vercel " +
        "dashboard, the newlines were stripped \u2014 use GITHUB_APP_PRIVATE_KEY_B64 instead.",
    );
  }

  try {
    // Auto-detects PKCS#1 and PKCS#8. No need to convert key formats.
    cachedKey = createPrivateKey({ key: raw, format: "pem" });
  } catch (err) {
    throw new Error(
      `Failed to parse GitHub App private key: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return cachedKey;
}

function requireAppId(): string {
  const id = env.GITHUB_APP_ID;
  if (!id) {
    throw new Error("GITHUB_APP_ID is not configured.");
  }
  return id;
}

/**
 * Mint a short-lived App-level JWT. Lifetime is **9 minutes** \u2014 GitHub
 * caps it at 10, we shave 60s so a request that begins at t=0 with this
 * token can still complete around t=9m without 401-ing. `iat` is also
 * backdated 30s to absorb modest clock skew between us and GitHub.
 */
export function mintAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 30,
    exp: now + 9 * 60,
    iss: requireAppId(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${HEADER_B64URL}.${payloadB64}`;

  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(loadPrivateKey())
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

/** Shape of the response from POST /app/installations/:id/access_tokens. */
export interface InstallationTokenResponse {
  token: string;
  /** ISO 8601 expiry, always exactly 1h from issue. */
  expiresAt: Date;
  /**
   * Per-permission grant the token actually got. Useful if your App
   * has 5 permissions but a user installed it on an account that
   * only allowed 3. Saved on the installation row for diagnostics.
   */
  permissions: Record<string, string>;
  /** Either "all" or "selected" \u2014 mirrors what the user picked at install time. */
  repositorySelection: "all" | "selected";
}

/**
 * Exchange an App JWT for an installation token. Returns the raw response
 * plus a parsed `expiresAt` Date. Callers are responsible for caching:
 * for the brain indexer that happens at `getInstallationToken(rowId)`,
 * which reads/writes `github_installations.cached_token` and respects
 * a 5-minute expiry buffer.
 */
export async function mintInstallationToken(
  installationId: number,
): Promise<InstallationTokenResponse> {
  const jwt = mintAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "yxuOS/1.0",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub installation token mint failed (${res.status}): ${body || res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    token: string;
    expires_at: string;
    permissions: Record<string, string>;
    repository_selection: "all" | "selected";
  };

  return {
    token: json.token,
    expiresAt: new Date(json.expires_at),
    permissions: json.permissions ?? {},
    repositorySelection: json.repository_selection,
  };
}

/**
 * Cheap health check for the App credentials. Calls `GET /app` (the App's
 * own profile, App-JWT-authenticated) and returns its slug. If the
 * private key is wrong or the App ID mismatches, this is where you'll
 * see the failure, with the actual GitHub error message.
 *
 * Use this in a one-shot script (`bun scripts/github-app-smoke.ts`) to
 * validate `.env.local` before wiring the install flow UI.
 */
export async function verifyAppCredentials(): Promise<{ id: number; slug: string; name: string }> {
  const jwt = mintAppJwt();
  const res = await fetch("https://api.github.com/app", {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yxuOS/1.0",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub App credential check failed (${res.status}): ${body || res.statusText}`,
    );
  }
  const json = (await res.json()) as { id: number; slug: string; name: string };
  return { id: json.id, slug: json.slug, name: json.name };
}
