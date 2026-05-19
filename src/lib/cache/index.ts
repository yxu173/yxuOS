/**
 * Application cache layer — a thin façade in front of Upstash Redis.
 *
 * Design constraints, in priority order:
 *
 * 1. **Never make the site slower.** Every helper degrades gracefully
 *    when Redis is unset, down, or slow — on any error we fall straight
 *    through to the loader and serve a normal response.
 * 2. **Two tiers of memoisation.** Within a single React request we use
 *    `react.cache()` so the same key never hits Redis twice. Across
 *    requests Redis backs the same key. The local memo is the difference
 *    between O(N) DB hits per page (today) and O(1) (with this module).
 * 3. **Tag-based invalidation.** Writes don't compute every key derived
 *    from a row; instead they bust *tags* (e.g. `team:${teamId}`) and the
 *    cache layer walks the tag's key set under the hood.
 * 4. **Boring keys.** Every key is namespaced (`y:`), every tag set is
 *    namespaced (`y:tag:`). Easy to spot in the Upstash console.
 * 5. **Strict typing.** `cached<T>` returns `T`, not `T | undefined` —
 *    if Redis is hot the loader doesn't run; if Redis is cold or absent
 *    the loader still runs and the result is returned as-is.
 *
 * Non-goals: distributed locking / stampede protection. The loaders we
 * cache are cheap DB queries with idempotent semantics — a brief
 * thundering herd on a cache miss is acceptable.
 */

import { cache as reactCache } from "react";

import { env } from "@/lib/env";

import { getRedis } from "./redis";

/** Stable string identifying a logical group of keys (for invalidation). */
export type CacheTag = string;

export interface CacheOptions {
  /** TTL in seconds. Required — forces callers to think about freshness. */
  ttl: number;
  /**
   * Tags to associate with this key. Writes bust tags via
   * {@link invalidateTag}; the cache layer walks each tag's key set
   * and deletes every member. Keep tags coarse — `team:${teamId}` is
   * better than `team:${teamId}:projects:slug:${slug}`.
   */
  tags?: CacheTag[];
}

const NS = () => env.CACHE_NAMESPACE;
const keyOf = (raw: string) => `${NS()}:${raw}`;
const tagKeyOf = (tag: string) => `${NS()}:tag:${tag}`;

/**
 * Run `loader()` exactly once per request for the given key, AND
 * persist its result in Redis for the given TTL.
 *
 * Order of operations:
 *   1. Per-request memo: if we've already computed this key in this
 *      React request, return the in-memory promise.
 *   2. Redis GET. On hit, return the parsed value.
 *   3. Run `loader()`. Write the value back to Redis (and register
 *      the key under each tag's set) in the background — never block
 *      the response on the write.
 *
 * Failures at step 2 or 3 are swallowed and logged; the request
 * never observes a cache outage.
 */
export async function cached<T>(
  key: string,
  options: CacheOptions,
  loader: () => Promise<T>,
): Promise<T> {
  // Per-request memo via React's `cache()` — `getRequestMemo` returns
  // the SAME Map instance for every call within one React request, and
  // a fresh one for the next. Outside a React request (e.g. an API
  // route), `cache()` still works — it just falls back to a per-call
  // Map, which is harmless (we'd skip step 1 effectively).
  const memo = getRequestMemo();
  const existing = memo.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async (): Promise<T> => {
    const redis = getRedis();
    if (redis) {
      try {
        const hit = await redis.get<T>(keyOf(key));
        if (hit !== null && hit !== undefined) {
          return hit;
        }
      } catch (err) {
        // Cache reads should never break the request.
        warn("cache.get failed", key, err);
      }
    }

    const value = await loader();

    if (redis) {
      // Fire-and-forget write so the response can return immediately.
      // Errors are logged; correctness is preserved by the loader.
      void writeBack(redis, key, value, options).catch((err) => {
        warn("cache.set failed", key, err);
      });
    }

    return value;
  })();

  memo.set(key, promise);
  // If the loader throws, drop the promise from the memo so the next
  // call in the same request can retry. Without this we'd serve the
  // same error to every callsite on the page.
  promise.catch(() => memo.delete(key));
  return promise;
}

/**
 * Delete one or more cached keys (e.g. after a write). Safe to call
 * with no Redis configured — does nothing.
 */
export async function invalidate(keys: string | string[]): Promise<void> {
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.length === 0) return;

  // Drop from the per-request memo too — otherwise an action that
  // writes and then re-reads in the same request gets a stale value.
  const memo = getRequestMemo();
  for (const k of list) memo.delete(k);

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(...list.map(keyOf));
  } catch (err) {
    warn("cache.del failed", list.join(","), err);
  }
}

/**
 * Bust every key registered under one or more tags.
 *
 * Implementation: for each tag, SMEMBERS its set, DEL every key in
 * the set, then DEL the set itself. A pipeline keeps this to two
 * round-trips per tag.
 */
export async function invalidateTag(
  tag: CacheTag | CacheTag[],
): Promise<void> {
  const tags = Array.isArray(tag) ? tag : [tag];
  if (tags.length === 0) return;

  // Per-request memo clears for any key we just busted. We don't
  // know the full key list for a tag here without a SMEMBERS call,
  // but the memo is short-lived (one request) so the worst case is
  // a single stale read inside the request that just invalidated —
  // which is *exactly* the request we want to invalidate FOR. Hence
  // the conservative move: flush the whole memo.
  resetRequestMemo();

  const redis = getRedis();
  if (!redis) return;
  try {
    for (const t of tags) {
      const setKey = tagKeyOf(t);
      const members = await redis.smembers(setKey);
      if (members.length > 0) {
        await redis.del(...members, setKey);
      } else {
        await redis.del(setKey);
      }
    }
  } catch (err) {
    warn("cache.invalidateTag failed", tags.join(","), err);
  }
}

/**
 * Build a cache key by joining segments with `:`. Use this instead of
 * hand-stringing keys so the namespace looks consistent in the Upstash
 * console (`y:project:teamId:slug`, never `y:project-teamId|slug`).
 */
export function cacheKey(...segments: (string | number)[]): string {
  return segments.map((s) => String(s)).join(":");
}

/* ─── internals ──────────────────────────────────────────── */

/** Single combined pipelined write: SET key value EX ttl + SADD per tag. */
async function writeBack<T>(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  key: string,
  value: T,
  options: CacheOptions,
) {
  const fullKey = keyOf(key);
  const pipe = redis.pipeline();
  pipe.set(fullKey, value, { ex: options.ttl });
  if (options.tags?.length) {
    for (const tag of options.tags) {
      const setKey = tagKeyOf(tag);
      pipe.sadd(setKey, fullKey);
      // Keep the tag set itself from leaking forever. Re-extend it
      // whenever we add a new member so the TTL stays ahead of the
      // entries themselves. Tag sets without an explicit TTL would
      // otherwise grow unboundedly in long-lived deployments.
      pipe.expire(setKey, Math.max(options.ttl * 4, 60 * 60 * 24));
    }
  }
  await pipe.exec();
}

/**
 * Per-request memo. `react.cache()` returns the same factory output
 * within a single React render pass; outside React (API routes), it
 * still works but isn't shared across the request — which is fine.
 * Either way the Map is short-lived and never crosses requests.
 */
const getRequestMemo = reactCache(
  () => new Map<string, Promise<unknown>>(),
);

/** Forget every per-request memoised entry. Called by invalidations. */
function resetRequestMemo() {
  getRequestMemo().clear();
}

function warn(...args: unknown[]) {
  if (env.NODE_ENV === "production") return;
  console.warn("[cache]", ...args);
}
