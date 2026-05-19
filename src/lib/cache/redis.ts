/**
 * Lazy singleton wrapper around the Upstash Redis REST client.
 *
 * We intentionally NEVER throw on missing config — when
 * `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are unset
 * the helper returns `null` and callers fall back to running the
 * underlying loader directly. That keeps local dev cheap (no
 * dependency on an external service) and lets prod ride out a
 * brief Upstash outage without blowing up the whole site.
 */

import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

let cached: Redis | null | undefined;

/**
 * Returns the shared Upstash Redis client, or `null` if the env
 * vars are missing. Memoised across the process — the REST client
 * is stateless so a single instance is fine for every request.
 */
export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    cached = null;
    return null;
  }
  cached = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    // Avoid polluting logs with noisy Upstash retries — the cache
    // layer already swallows errors and falls back to the loader.
    automaticDeserialization: true,
  });
  return cached;
}

/** Test hook — never call from app code. */
export function _resetRedisForTests() {
  cached = undefined;
}
