import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  PUBSUB_REDIS_CLIENT,
  PubSubRedisProvider,
  REDIS_CLIENT,
  RedisProvider,
} from "../../config/infrastructure.tokens";

let redis: RedisProvider | undefined;
let pubSub: PubSubRedisProvider | undefined;
const getRedis = () => {
  if (!redis) throw new Error("CacheService has not been initialized by Nest");
  return redis;
};
const getPubSub = () => {
  if (!pubSub) {
    throw new Error("CacheService has not been initialized by Nest");
  }
  return pubSub;
};

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// L1 is deliberately short-lived and bounded. Redis remains the shared L2 and
// source of cache truth across all Node.js instances.
const L1_TTL_MS = positiveNumberFromEnv(process.env.L1_CACHE_TTL_MS, 5_000);
const L1_MAX_ENTRIES = positiveNumberFromEnv(
  process.env.L1_CACHE_MAX_ENTRIES,
  1_000,
);
const L1_MAX_BYTES = positiveNumberFromEnv(
  process.env.L1_CACHE_MAX_BYTES,
  32 * 1024 * 1024,
);
const L1_SWR_RETRY_BACKOFF_MS = positiveNumberFromEnv(
  process.env.L1_CACHE_SWR_RETRY_BACKOFF_MS,
  1_000,
);
const LOCK_TTL_MS = positiveNumberFromEnv(
  process.env.CACHE_LOCK_TTL_MS,
  10_000,
);
const LOCK_WAIT_MS = positiveNumberFromEnv(
  process.env.CACHE_LOCK_WAIT_MS,
  LOCK_TTL_MS + 500,
);
const MAX_CACHE_FILL_LOCK_ATTEMPTS = 3;
const REDIS_FAILURE_BACKOFF_MS = positiveNumberFromEnv(
  process.env.CACHE_REDIS_FAILURE_BACKOFF_MS,
  3000,
);
const MAX_DB_FALLBACK_CONCURRENCY = positiveNumberFromEnv(
  process.env.CACHE_DB_FALLBACK_MAX_CONCURRENT,
  50,
);
const CACHE_REDIS_FAILURE_LOG_INTERVAL_MS = 30_000;
const MAX_PENDING_CACHE_INVALIDATIONS = 10_000;
const CACHE_INVALIDATION_RETRY_INITIAL_MS = 1_000;
const CACHE_INVALIDATION_RETRY_MAX_MS = 30_000;
const INVALIDATION_CHANNEL = "cache:l1:invalidate:v1";
const MAX_INVALIDATION_BATCH_SIZE = 500;
const MAX_STALE_WHILE_REVALIDATE_MS = 5 * 60_000;
const L2_SWR_RECORD_VERSION = 1;
const L2_NEGATIVE_RECORD_VERSION = 1;
// This Redis counter intentionally has no TTL. Redis persistence/eviction
// policy must preserve it so generations are never reused after restart.
const CACHE_FILL_GENERATION_KEY = "cache:fill-generation:v1";
const CACHE_FILL_LOCK_PREFIX = "cache:fill-lock:";
const CACHE_TAG_INDEX_PREFIX = "cache:tag-index:";
const CACHE_TAG_SET_V2_PREFIX = "cache:tag-set:v2:";
const CACHE_TAG_FILL_PREFIX = "cache:tag-fills:v1:";
const INSTANCE_ID = `${process.pid}:${randomUUID()}`;
const GET_OR_CREATE_TRACKER_SCRIPT = `
-- GET_OR_CREATE_TRACKER_V1
local version = redis.call("GET", KEYS[1])
if version then
  return version
end
redis.call("SET", KEYS[1], "1", "NX")
return redis.call("GET", KEYS[1])
`;
const ACQUIRE_CACHE_FILL_LOCK_SCRIPT = `
-- ACQUIRE_CACHE_FILL_LOCK_V1
if redis.call("EXISTS", KEYS[1]) == 1 then
  return false
end

-- A monotonic Redis generation is the fencing token. It is never cached in L1.
redis.call("INCR", KEYS[2])
local generation_value = redis.call("GET", KEYS[2])
redis.call("SET", KEYS[1], generation_value, "PX", ARGV[1])
-- Register tagged fills atomically with lock acquisition, before source I/O.
for index = 3, #KEYS do
  redis.call("HSET", KEYS[index], ARGV[2], generation_value)
  redis.call("PEXPIRE", KEYS[index], ARGV[3])
end
return generation_value
`;
const RELEASE_CACHE_FILL_LOCK_SCRIPT = `
-- RELEASE_CACHE_FILL_LOCK_V1
local released = 0
if redis.call("GET", KEYS[1]) == ARGV[1] then
  released = redis.call("UNLINK", KEYS[1])
end

for index = 2, #KEYS do
  if redis.call("HGET", KEYS[index], ARGV[2]) == ARGV[1] then
    redis.call("HDEL", KEYS[index], ARGV[2])
  end
end
return released
`;
const STORE_CACHE_IF_LOCK_OWNER_SCRIPT = `
-- STORE_CACHE_IF_LOCK_OWNER_V1
if redis.call("GET", KEYS[2]) ~= ARGV[3] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return 1
`;
const INVALIDATE_TAGS_SCRIPT = `
-- INVALIDATE_TAGS_V2
local cache_keys = {}
local seen = {}
local tag_set_key_count = tonumber(ARGV[3])
local time = redis.call("TIME")
local now_ms = time[1] * 1000 + math.floor(time[2] / 1000)

for index = 1, tag_set_key_count do
  local tag_key = KEYS[index]
  local key_type = redis.call("TYPE", tag_key).ok
  local members = {}
  if key_type == "zset" then
    redis.call("ZREMRANGEBYSCORE", tag_key, "-inf", now_ms)
    members = redis.call("ZRANGEBYSCORE", tag_key, "(" .. now_ms, "+inf")
  elseif key_type == "set" then
    members = redis.call("SMEMBERS", tag_key)
  end
  for _, cache_key in ipairs(members) do
    if redis.call("EXISTS", cache_key) == 1 then
      if not seen[cache_key] then
        seen[cache_key] = true
        table.insert(cache_keys, cache_key)
      end
    elseif key_type == "zset" then
      redis.call("ZREM", tag_key, cache_key)
    elseif key_type == "set" then
      redis.call("SREM", tag_key, cache_key)
    end
  end
end

for _, cache_key in ipairs(cache_keys) do
  local index_key = ARGV[1] .. cache_key
  local cache_tags = redis.call("SMEMBERS", index_key)
  for _, cache_tag in ipairs(cache_tags) do
    local key_type = redis.call("TYPE", cache_tag).ok
    if key_type == "zset" then
      redis.call("ZREM", cache_tag, cache_key)
    elseif key_type == "set" then
      redis.call("SREM", cache_tag, cache_key)
    end
  end
  redis.call("UNLINK", cache_key)
  redis.call("UNLINK", ARGV[2] .. cache_key)
  redis.call("UNLINK", index_key)
end

-- A tagged fill is registered before its source fetch begins. Removing its
-- active lock here fences the fill even if this instance misses Pub/Sub.
for index = tag_set_key_count + 1, #KEYS do
  local active_fills = redis.call("HGETALL", KEYS[index])
  for fill_index = 1, #active_fills, 2 do
    local cache_key = active_fills[fill_index]
    local generation = active_fills[fill_index + 1]
    local lock_key = ARGV[2] .. cache_key
    if redis.call("GET", lock_key) == generation then
      redis.call("UNLINK", lock_key)
    end
  end
  redis.call("UNLINK", KEYS[index])
end

for index = 1, tag_set_key_count do
  local tag_key = KEYS[index]
  redis.call("UNLINK", tag_key)
end

return cache_keys
`;
const STORE_TAGGED_CACHE_SCRIPT = `
-- STORE_TAGGED_CACHE_V2
local cache_key = KEYS[1]
local index_key = KEYS[2]
local lock_key = KEYS[3]
if redis.call("GET", lock_key) ~= ARGV[3] then
  return 0
end

local ttl_seconds = tonumber(ARGV[2])
local old_tags = redis.call("SMEMBERS", index_key)
local redis_time = redis.call("TIME")
local now_ms = redis_time[1] * 1000 + math.floor(redis_time[2] / 1000)
-- Leave a one-second grace so the index cannot expire just before the cache
-- key's Redis EX deadline due to command execution time/rounding.
local expires_at_ms = now_ms + (ttl_seconds + 1) * 1000

for _, old_tag in ipairs(old_tags) do
  local key_type = redis.call("TYPE", old_tag).ok
  if key_type == "zset" then
    redis.call("ZREM", old_tag, cache_key)
  elseif key_type == "set" then
    redis.call("SREM", old_tag, cache_key)
  end
end
redis.call("UNLINK", index_key)
redis.call("SET", cache_key, ARGV[1], "EX", ttl_seconds)

for index = 4, #KEYS do
  local tag_key = KEYS[index]
  redis.call("ZREMRANGEBYSCORE", tag_key, "-inf", now_ms)
  redis.call("ZADD", tag_key, expires_at_ms, cache_key)
  redis.call("EXPIRE", tag_key, ttl_seconds)
  redis.call("SADD", index_key, tag_key)
end
redis.call("EXPIRE", index_key, ttl_seconds)
return 1
`;
const DELETE_CACHE_KEYS_SCRIPT = `
-- DELETE_CACHE_KEYS_V1
local deleted = 0
for _, cache_key in ipairs(KEYS) do
  local index_key = ARGV[1] .. cache_key
  local cache_tags = redis.call("SMEMBERS", index_key)
  for _, cache_tag in ipairs(cache_tags) do
    local key_type = redis.call("TYPE", cache_tag).ok
    if key_type == "zset" then
      redis.call("ZREM", cache_tag, cache_key)
    elseif key_type == "set" then
      redis.call("SREM", cache_tag, cache_key)
    end
  end
  redis.call("UNLINK", index_key)
  -- Invalidation revokes the current fill generation atomically with deletion.
  redis.call("UNLINK", ARGV[2] .. cache_key)
  deleted = deleted + redis.call("UNLINK", cache_key)
end
return deleted
`;
const WRITE_THROUGH_CACHE_SCRIPT = `
-- WRITE_THROUGH_CACHE_V1
local cache_key = KEYS[1]
local index_key = KEYS[2]
local lock_key = KEYS[3]
local generation_key = KEYS[4]
local ttl_seconds = tonumber(ARGV[2])
local lock_ttl_ms = tonumber(ARGV[4])
local tag_key_count = tonumber(ARGV[6])

-- A successful database write supersedes every cache fill that started before
-- it. Advance the shared fence and publish the new cache value atomically.
redis.call("INCR", generation_key)
local generation = redis.call("GET", generation_key)
redis.call("SET", lock_key, generation, "PX", lock_ttl_ms)

for index = 5 + tag_key_count, #KEYS do
  redis.call("HSET", KEYS[index], ARGV[5], generation)
  redis.call("PEXPIRE", KEYS[index], lock_ttl_ms + 1000)
end

local cache_tags = redis.call("SMEMBERS", index_key)
for _, cache_tag in ipairs(cache_tags) do
  local key_type = redis.call("TYPE", cache_tag).ok
  if key_type == "zset" then
    redis.call("ZREM", cache_tag, cache_key)
  elseif key_type == "set" then
    redis.call("SREM", cache_tag, cache_key)
  end
end
redis.call("UNLINK", index_key)
redis.call("UNLINK", cache_key)

redis.call("SET", cache_key, ARGV[1], "EX", ttl_seconds)
local redis_time = redis.call("TIME")
local now_ms = redis_time[1] * 1000 + math.floor(redis_time[2] / 1000)
local expires_at_ms = now_ms + (ttl_seconds + 1) * 1000
for index = 5, 4 + tag_key_count do
  local tag_key = KEYS[index]
  redis.call("ZREMRANGEBYSCORE", tag_key, "-inf", now_ms)
  redis.call("ZADD", tag_key, expires_at_ms, cache_key)
  redis.call("EXPIRE", tag_key, ttl_seconds)
  redis.call("SADD", index_key, tag_key)
end
redis.call("EXPIRE", index_key, ttl_seconds)
return generation
`;

type L1Entry = {
  value: unknown;
  expiresAt: number;
  staleUntil: number;
  refreshAfter: number;
  size: number;
  tags: string[];
};

type L1Read<T> =
  | { hit: false }
  | {
      hit: true;
      value: T;
      isStale: boolean;
      shouldRefresh: boolean;
    };

type L1InvalidationMessage =
  | { source: string; type: "key"; value: string }
  | { source: string; type: "tag-prefix"; value: string }
  | { source: string; type: "keys-batch"; value: string[] };

type L2SWRRecord = {
  __cacheSWR: typeof L2_SWR_RECORD_VERSION;
  payload: string;
  freshUntil: number;
  staleUntil: number;
};

type L2NegativeRecord = {
  __cacheNegative: typeof L2_NEGATIVE_RECORD_VERSION;
  expiresAt: number;
};

type CacheLoadOptions<T> = {
  key: string;
  fetchFn: () => Promise<T>;
  ttl: number;
  negativeCacheTtlSeconds?: number;
  staleWhileRevalidateMs?: number;
  tags?: string[];
  encode: (value: T) => string;
  decode: (raw: string) => T;
  shouldCache?: (value: T) => boolean;
};

type InFlightLoad = {
  promise: Promise<unknown>;
  tags: string[];
  invalidated: boolean;
};

type PendingInvalidation = {
  kind: "key" | "tag" | "tracker";
  value: string;
};

const l1Cache = new Map<string, L1Entry>();
const l1TagKeys = new Map<string, Set<string>>();
let l1Bytes = 0;

// Prevents a thundering herd inside one Node.js process.
const inFlight = new Map<string, InFlightLoad>();
let invalidationSubscriptionStarted = false;
let redisCircuitOpenUntil = 0;
let redisProbeInFlight = false;
let dbFallbackInFlight = 0;
let lastCacheRedisFailureLogAt = 0;
let lastPendingInvalidationLogAt = 0;
let lastCachePubSubFailureLogAt = 0;
let pendingInvalidationRetryMs = CACHE_INVALIDATION_RETRY_INITIAL_MS;
let pendingInvalidationTimer: NodeJS.Timeout | undefined;
let pendingInvalidationFlushInFlight = false;
const pendingInvalidations = new Map<string, PendingInvalidation>();
const offlineTrackerVersions = new Map<string, number>();

const tagName = (tag: string) => `tag:${tag}`;
const tagSetKey = (tagKey: string) => `${CACHE_TAG_SET_V2_PREFIX}${tagKey}`;
const tagFillKey = (tagKey: string) => `${CACHE_TAG_FILL_PREFIX}${tagKey}`;
const tagIndexKey = (key: string) => `${CACHE_TAG_INDEX_PREFIX}${key}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldBypassRedis = () => {
  if (redisCircuitOpenUntil === 0) return false;
  if (Date.now() < redisCircuitOpenUntil || redisProbeInFlight) return true;

  // After the cooldown, allow exactly one request to probe Redis. Other
  // requests use bounded DB fallback until that probe succeeds or fails.
  redisProbeInFlight = true;
  return false;
};

const noteRedisSuccess = () => {
  redisCircuitOpenUntil = 0;
  redisProbeInFlight = false;
};

const noteRedisFailure = (error: unknown) => {
  redisCircuitOpenUntil = Date.now() + REDIS_FAILURE_BACKOFF_MS;
  redisProbeInFlight = false;

  const now = Date.now();
  if (now - lastCacheRedisFailureLogAt < CACHE_REDIS_FAILURE_LOG_INTERVAL_MS) {
    return;
  }
  lastCacheRedisFailureLogAt = now;
  console.warn("Cache Redis unavailable; using bounded source fallback", error);
};

const advanceOfflineTrackerVersion = (key: string) => {
  const nextVersion = Math.max(Date.now(), (offlineTrackerVersions.get(key) ?? 0) + 1);
  offlineTrackerVersions.set(key, nextVersion);
  return String(nextVersion);
};

const fetchWithBoundedFallback = async <T>(fetchFn: () => Promise<T>) => {
  if (dbFallbackInFlight >= MAX_DB_FALLBACK_CONCURRENCY) {
    throw new ServiceUnavailableException(
      "Cache is unavailable and the database fallback is at capacity",
    );
  }

  dbFallbackInFlight += 1;
  try {
    // Deliberately do not populate L1 here: Redis invalidation is unavailable,
    // so extending a local value's lifetime could preserve stale data.
    return await fetchFn();
  } finally {
    dbFallbackInFlight -= 1;
  }
};

// A cache fill is shared by multiple requests. Abort only this caller's wait;
// the shared operation must continue so another request can still use it.
const waitForPromise = <T>(promise: Promise<T>, signal?: AbortSignal) => {
  if (!signal) return promise;
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const removeL1Key = (key: string) => {
  const entry = l1Cache.get(key);
  if (!entry) return;

  l1Cache.delete(key);
  l1Bytes -= entry.size;
  for (const tag of entry.tags) {
    const keys = l1TagKeys.get(tag);
    keys?.delete(key);
    if (keys?.size === 0) l1TagKeys.delete(tag);
  }
};

const invalidateL1Key = (key: string) => {
  for (const flightKey of [key, `refresh:${key}`]) {
    const flight = inFlight.get(flightKey);
    if (!flight) continue;
    flight.invalidated = true;
    inFlight.delete(flightKey);
  }
  removeL1Key(key);
};

const readL1 = <T>(key: string): L1Read<T> => {
  const entry = l1Cache.get(key);
  if (!entry) return { hit: false };
  const now = Date.now();
  if (entry.staleUntil <= now) {
    removeL1Key(key);
    return { hit: false };
  }

  // Refresh insertion order to make the bounded map an LRU cache.
  l1Cache.delete(key);
  l1Cache.set(key, entry);

  const isStale = entry.expiresAt <= now;
  let shouldRefresh = false;
  if (isStale && entry.refreshAfter <= now) {
    entry.refreshAfter = now + L1_SWR_RETRY_BACKOFF_MS;
    shouldRefresh = true;
  }
  return {
    hit: true,
    value: entry.value as T,
    isStale,
    shouldRefresh,
  };
};

const writeL1 = <T>(
  key: string,
  value: T,
  encodedSize: number,
  ttlSeconds: number,
  tags: string[] = [],
  staleWhileRevalidateMs = 0,
  absoluteFreshUntil?: number,
  absoluteStaleUntil?: number,
) => {
  if (encodedSize > L1_MAX_BYTES) return;
  removeL1Key(key);

  while (
    l1Cache.size >= L1_MAX_ENTRIES ||
    l1Bytes + encodedSize > L1_MAX_BYTES
  ) {
    const oldestKey = l1Cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    removeL1Key(oldestKey);
  }

  const normalizedTags = tags.map(tagName);
  // Small jitter avoids all L1 entries expiring on the exact same millisecond.
  const ttlMs = Math.min(L1_TTL_MS, ttlSeconds * 1_000);
  const jitteredTtlMs = Math.max(
    1,
    Math.floor(ttlMs * (0.9 + Math.random() * 0.1)),
  );
  const swrMs = Number.isFinite(staleWhileRevalidateMs)
    ? Math.min(
        MAX_STALE_WHILE_REVALIDATE_MS,
        Math.max(0, staleWhileRevalidateMs),
      )
    : 0;
  const expiresAt = Math.min(
    Date.now() + jitteredTtlMs,
    absoluteFreshUntil ?? Number.POSITIVE_INFINITY,
  );
  l1Cache.set(key, {
    value,
    expiresAt,
    staleUntil: Math.min(
      expiresAt + swrMs,
      absoluteStaleUntil ?? Number.POSITIVE_INFINITY,
    ),
    refreshAfter: expiresAt,
    size: encodedSize,
    tags: normalizedTags,
  });
  l1Bytes += encodedSize;

  for (const tag of normalizedTags) {
    const keys = l1TagKeys.get(tag) ?? new Set<string>();
    keys.add(key);
    l1TagKeys.set(tag, keys);
  }
};

const getStaleWhileRevalidateMs = (value: number) =>
  Number.isFinite(value)
    ? Math.min(MAX_STALE_WHILE_REVALIDATE_MS, Math.max(0, value))
    : 0;

const isL2SWRRecord = (value: unknown): value is L2SWRRecord =>
  typeof value === "object" &&
  value !== null &&
  "__cacheSWR" in value &&
  value.__cacheSWR === L2_SWR_RECORD_VERSION &&
  "payload" in value &&
  typeof value.payload === "string" &&
  "freshUntil" in value &&
  typeof value.freshUntil === "number" &&
  Number.isFinite(value.freshUntil) &&
  "staleUntil" in value &&
  typeof value.staleUntil === "number" &&
  Number.isFinite(value.staleUntil) &&
  value.staleUntil >= value.freshUntil;

const isL2NegativeRecord = (value: unknown): value is L2NegativeRecord =>
  typeof value === "object" &&
  value !== null &&
  "__cacheNegative" in value &&
  value.__cacheNegative === L2_NEGATIVE_RECORD_VERSION &&
  "expiresAt" in value &&
  typeof value.expiresAt === "number" &&
  Number.isFinite(value.expiresAt);

const createL2SWRRecord = (
  payload: string,
  ttlSeconds: number,
  staleWhileRevalidateMs: number,
) => {
  const swrMs = getStaleWhileRevalidateMs(staleWhileRevalidateMs);
  if (swrMs <= 0) {
    return {
      value: payload,
      freshUntil: undefined,
      staleUntil: undefined,
      redisTtlSeconds: ttlSeconds,
    };
  }

  const freshUntil = Date.now() + ttlSeconds * 1_000;
  const staleUntil = freshUntil + swrMs;
  const record: L2SWRRecord = {
    __cacheSWR: L2_SWR_RECORD_VERSION,
    payload,
    freshUntil,
    staleUntil,
  };
  return {
    value: JSON.stringify(record),
    freshUntil,
    staleUntil,
    redisTtlSeconds: Math.ceil((ttlSeconds * 1_000 + swrMs) / 1_000),
  };
};

const removeL1ByTag = (tagKey: string) => {
  for (const [key, flight] of inFlight) {
    if (flight.tags.includes(tagKey)) {
      flight.invalidated = true;
      inFlight.delete(key);
    }
  }

  const keys = l1TagKeys.get(tagKey);
  if (keys) for (const key of [...keys]) removeL1Key(key);
};

const publishInvalidation = async (
  message: Omit<L1InvalidationMessage, "source">,
) => {
  try {
    const publisher = getPubSub().pubClient;
    if (!publisher) return;
    await publisher.publish(
      INVALIDATION_CHANNEL,
      JSON.stringify({ ...message, source: INSTANCE_ID }),
    );
  } catch (error) {
    const now = Date.now();
    if (now - lastCachePubSubFailureLogAt >= CACHE_REDIS_FAILURE_LOG_INTERVAL_MS) {
      lastCachePubSubFailureLogAt = now;
      // L1's short TTL is the fallback if Pub/Sub is temporarily unavailable.
      console.warn("Unable to publish L1 cache invalidation", error);
    }
  }
};

const invalidateTagInRedis = async (tag: string) => {
  const tagKey = tagName(tag);
  const redisTagKeys = [tagSetKey(tagKey), tagKey];
  const removedKeys = (await getRedis().eval(INVALIDATE_TAGS_SCRIPT, {
    keys: [...redisTagKeys, tagFillKey(tagKey)],
    arguments: [
      CACHE_TAG_INDEX_PREFIX,
      CACHE_FILL_LOCK_PREFIX,
      String(redisTagKeys.length),
    ],
  })) as string[];
  for (const key of removedKeys) removeL1Key(key);
};

const executePendingInvalidation = async (invalidation: PendingInvalidation) => {
  if (invalidation.kind === "key") {
    await getRedis().eval(DELETE_CACHE_KEYS_SCRIPT, {
      keys: [invalidation.value],
      arguments: [CACHE_TAG_INDEX_PREFIX, CACHE_FILL_LOCK_PREFIX],
    });
    await publishInvalidation({ type: "key", value: invalidation.value });
    return;
  }

  if (invalidation.kind === "tracker") {
    await getRedis().incr(invalidation.value);
    await publishInvalidation({ type: "key", value: invalidation.value });
    return;
  }

  await invalidateTagInRedis(invalidation.value);
  await publishInvalidation({
    type: "tag-prefix",
    value: tagName(invalidation.value),
  });
};

const schedulePendingInvalidationRetry = (delayMs = pendingInvalidationRetryMs) => {
  if (pendingInvalidations.size === 0 || pendingInvalidationTimer) return;
  pendingInvalidationTimer = setTimeout(() => {
    pendingInvalidationTimer = undefined;
    void flushPendingInvalidations();
  }, delayMs);
  pendingInvalidationTimer.unref?.();
};

const enqueuePendingInvalidation = (invalidation: PendingInvalidation) => {
  const id = `${invalidation.kind}:${invalidation.value}`;
  if (
    !pendingInvalidations.has(id) &&
    pendingInvalidations.size >= MAX_PENDING_CACHE_INVALIDATIONS
  ) {
    const now = Date.now();
    if (now - lastPendingInvalidationLogAt >= CACHE_REDIS_FAILURE_LOG_INTERVAL_MS) {
      lastPendingInvalidationLogAt = now;
      console.error(
        "Pending cache invalidation queue is full; durable outbox is required to avoid losing invalidations",
      );
    }
    return;
  }

  pendingInvalidations.set(id, invalidation);
  schedulePendingInvalidationRetry();
};

const flushPendingInvalidations = async () => {
  if (pendingInvalidationFlushInFlight || pendingInvalidations.size === 0) return;
  pendingInvalidationFlushInFlight = true;
  let failed = false;
  try {
    for (const [id, invalidation] of pendingInvalidations) {
      try {
        await executePendingInvalidation(invalidation);
        noteRedisSuccess();
        if (pendingInvalidations.get(id) === invalidation) {
          pendingInvalidations.delete(id);
        }
      } catch (error) {
        noteRedisFailure(error);
        failed = true;
        break;
      }
    }
  } finally {
    pendingInvalidationFlushInFlight = false;
    if (pendingInvalidations.size === 0) {
      pendingInvalidationRetryMs = CACHE_INVALIDATION_RETRY_INITIAL_MS;
    } else {
      if (failed) {
        pendingInvalidationRetryMs = Math.min(
          pendingInvalidationRetryMs * 2,
          CACHE_INVALIDATION_RETRY_MAX_MS,
        );
      }
      schedulePendingInvalidationRetry();
    }
  }
};

const isL1InvalidationMessage = (
  value: unknown,
): value is L1InvalidationMessage => {
  if (typeof value !== "object" || value === null || !("source" in value)) {
    return false;
  }
  if (typeof value.source !== "string" || !("type" in value) || !("value" in value)) {
    return false;
  }
  if (value.type === "key" || value.type === "tag-prefix") {
    return typeof value.value === "string";
  }
  return (
    value.type === "keys-batch" &&
    Array.isArray(value.value) &&
    value.value.length > 0 &&
    value.value.length <= MAX_INVALIDATION_BATCH_SIZE &&
    value.value.every((key) => typeof key === "string")
  );
};

const subscribeToInvalidations = () => {
  const subscriber = getPubSub().subClient;
  if (!subscriber || invalidationSubscriptionStarted) return;
  invalidationSubscriptionStarted = true;

  void subscriber
    .subscribe(INVALIDATION_CHANNEL, (rawMessage) => {
      try {
        const parsed: unknown = JSON.parse(rawMessage);
        if (!isL1InvalidationMessage(parsed)) {
          throw new TypeError("Invalid L1 cache invalidation message shape");
        }
        const message = parsed;
        if (message.source === INSTANCE_ID) return;
        if (message.type === "key") invalidateL1Key(message.value);
        if (message.type === "tag-prefix") {
          // Wire type kept for rolling-deploy compatibility; current writers
          // publish exact tag keys, matching the Redis tag-set semantics.
          removeL1ByTag(message.value);
        }
        if (message.type === "keys-batch") {
          for (const key of message.value) invalidateL1Key(key);
        }
      } catch (error) {
        console.warn("Ignoring invalid L1 cache invalidation message", error);
      }
    })
    .catch((error) => {
      invalidationSubscriptionStarted = false;
      console.warn("Unable to subscribe to L1 cache invalidations", error);
    });
};

const acquireCacheFillLock = async (
  lockKey: string,
  key: string,
  tags: string[],
) => {
  const activeFillKeys = [...new Set(tags.map(tagName))].map(tagFillKey);
  const result: unknown = await getRedis().eval(
    ACQUIRE_CACHE_FILL_LOCK_SCRIPT,
    {
      keys: [lockKey, CACHE_FILL_GENERATION_KEY, ...activeFillKeys],
      arguments: [
        String(LOCK_TTL_MS),
        key,
        String(LOCK_TTL_MS + 1_000),
      ],
    },
  );
  if (typeof result === "string" && /^[1-9]\d*$/.test(result)) return result;
  if (typeof result === "number" && Number.isSafeInteger(result) && result > 0) {
    return String(result);
  }
  return null;
};

const releaseLock = async (
  lockKey: string,
  generation: string,
  key: string,
  tags: string[],
) => {
  const activeFillKeys = [...new Set(tags.map(tagName))].map(tagFillKey);
  await getRedis().eval(RELEASE_CACHE_FILL_LOCK_SCRIPT, {
    keys: [lockKey, ...activeFillKeys],
    arguments: [generation, key],
  });
};

const waitForL2Value = async (key: string, lockKey: string) => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let delayMs = 20;
  while (Date.now() < deadline) {
    // Jitter prevents waiting instances from polling Redis in lockstep.
    await sleep(delayMs + Math.floor(Math.random() * 20));
    const values = await getRedis().mGet([key, lockKey]);
    const cached = values[0] ?? null;
    const activeLock = values[1] ?? null;
    if (cached !== null) return cached;
    // The owner failed and released its lock without filling the cache. Let a
    // waiter attempt takeover immediately instead of waiting for the deadline.
    if (activeLock === null) return null;
    delayMs = Math.min(Math.floor(delayMs * 1.5), 200);
  }
  return null;
};

const startCacheLoad = <T>(
  options: CacheLoadOptions<T>,
  forceRefresh = false,
): Promise<T> => {
  const { key, fetchFn, ttl, tags = [], encode, decode } = options;
  const staleWhileRevalidateMs = getStaleWhileRevalidateMs(
    options.staleWhileRevalidateMs ?? 0,
  );
  const negativeCacheTtlSeconds =
    options.negativeCacheTtlSeconds !== undefined &&
    Number.isFinite(options.negativeCacheTtlSeconds) &&
    options.negativeCacheTtlSeconds > 0
      ? options.negativeCacheTtlSeconds
      : 0;
  const shouldCache = options.shouldCache ?? (() => true);
  const flightKey = forceRefresh ? `refresh:${key}` : key;

  const existingFlight = inFlight.get(flightKey);
  if (existingFlight) return existingFlight.promise as Promise<T>;

  const flight: InFlightLoad = {
    promise: Promise.resolve(),
    tags: tags.map(tagName),
    invalidated: false,
  };

  const request = (async () => {
    if (shouldBypassRedis()) {
      return fetchWithBoundedFallback(fetchFn);
    }

    const restoreCachedValue = (raw: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = undefined;
      }

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "__cacheNegative" in parsed
      ) {
        if (!isL2NegativeRecord(parsed)) return undefined;
        const now = Date.now();
        if (parsed.expiresAt <= now) return undefined;
        const negativePayload = "null";
        return {
          value: decode(negativePayload),
          encodedSize: Buffer.byteLength(negativePayload),
          isStale: false,
          ttlSeconds: negativeCacheTtlSeconds,
          staleWhileRevalidateMs: 0,
          freshUntil: parsed.expiresAt,
          staleUntil: parsed.expiresAt,
        };
      }

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "__cacheSWR" in parsed
      ) {
        if (!isL2SWRRecord(parsed)) return undefined;
        const now = Date.now();
        if (parsed.staleUntil <= now) return undefined;
        const isStale = parsed.freshUntil <= now;
        if (isStale && staleWhileRevalidateMs <= 0) return undefined;
        return {
          value: decode(parsed.payload),
          encodedSize: Buffer.byteLength(parsed.payload),
          isStale,
          ttlSeconds: ttl,
          staleWhileRevalidateMs,
          freshUntil: parsed.freshUntil,
          staleUntil: parsed.staleUntil,
        };
      }

      // Accept pre-envelope entries during deployment rollouts. They retain
      // their original Redis TTL and become enveloped on the next source fill.
      return {
        value: decode(raw),
        encodedSize: Buffer.byteLength(raw),
        isStale: false,
        ttlSeconds:
          parsed === null && negativeCacheTtlSeconds > 0
            ? negativeCacheTtlSeconds
            : ttl,
        staleWhileRevalidateMs: parsed === null ? 0 : staleWhileRevalidateMs,
        freshUntil: undefined,
        staleUntil: undefined,
      };
    };

    const useCachedValue = (cached: string) => {
      const restored = restoreCachedValue(cached);
      if (!restored) return undefined;
      if (!flight.invalidated) {
        writeL1(
          key,
          restored.value,
          restored.encodedSize,
          restored.ttlSeconds,
          tags,
          restored.staleWhileRevalidateMs,
          restored.freshUntil,
          restored.staleUntil,
        );
      }
      if (restored.isStale && !flight.invalidated) {
        void startCacheLoad(options, true).catch((error: unknown) => {
          console.warn("Background L2 cache refresh failed", error);
        });
      }
      return restored.value;
    };

    // Keep the normal L2 lookup inside single-flight; a background refresh
    // skips it because the caller already proved the entry is stale.
    if (!forceRefresh) {
      let cached: string | null;
      try {
        cached = await getRedis().get(key);
        noteRedisSuccess();
      } catch (error) {
        noteRedisFailure(error);
        return fetchWithBoundedFallback(fetchFn);
      }
      if (cached !== null) {
        const restored = useCachedValue(cached);
        if (restored !== undefined) return restored;
      }
    }

    const lockKey = `${CACHE_FILL_LOCK_PREFIX}${key}`;
    let lockGeneration: string | null = null;
    try {
      for (
        let attempt = 0;
        attempt < MAX_CACHE_FILL_LOCK_ATTEMPTS && lockGeneration === null;
        attempt += 1
      ) {
        lockGeneration = await acquireCacheFillLock(lockKey, key, tags);
        noteRedisSuccess();
        if (lockGeneration !== null) break;
        // Background SWR callers already returned stale data to the user. Do
        // not wait or query the source when another instance owns refresh.
        if (forceRefresh) return undefined as T;

        const remoteValue = await waitForL2Value(key, lockKey);
        noteRedisSuccess();
        if (remoteValue !== null) {
          const restored = useCachedValue(remoteValue);
          if (restored !== undefined) return restored;
        }
      }
    } catch (error) {
      noteRedisFailure(error);
      return fetchWithBoundedFallback(fetchFn);
    }
    if (lockGeneration === null) {
      return fetchWithBoundedFallback(fetchFn);
    }

    try {
      const freshData = await fetchFn();
      const isNegativeCacheValue =
        freshData === null && negativeCacheTtlSeconds > 0;
      if (!shouldCache(freshData) && !isNegativeCacheValue) {
        // A stale value must not survive a refresh that now resolves to a
        // non-cacheable result (for example, a deleted resource).
        if (forceRefresh) {
          try {
            await getRedis().eval(DELETE_CACHE_KEYS_SCRIPT, {
              keys: [key],
              arguments: [CACHE_TAG_INDEX_PREFIX, CACHE_FILL_LOCK_PREFIX],
            });
            noteRedisSuccess();
            await publishInvalidation({ type: "key", value: key });
          } catch (error) {
            noteRedisFailure(error);
          }
        }
        return freshData;
      }

      const raw = encode(freshData);
      const effectiveTtlSeconds = isNegativeCacheValue
        ? negativeCacheTtlSeconds
        : ttl;
      const cacheRecord = isNegativeCacheValue
        ? (() => {
            const expiresAt = Date.now() + effectiveTtlSeconds * 1_000;
            return {
              value: JSON.stringify({
                __cacheNegative: L2_NEGATIVE_RECORD_VERSION,
                expiresAt,
              } satisfies L2NegativeRecord),
              freshUntil: expiresAt,
              staleUntil: expiresAt,
              redisTtlSeconds: effectiveTtlSeconds,
            };
          })()
        : createL2SWRRecord(raw, effectiveTtlSeconds, staleWhileRevalidateMs);
      // An explicit invalidation may arrive while this fill is waiting on
      // Redis or the database. Do not let that older fill repopulate L2/L1.
      if (flight.invalidated) return freshData;

      let storedInRedis = false;
      try {
        if (tags.length > 0) {
          const redisTags = tags.map((tag) => tagSetKey(tagName(tag)));
          const storeResult = await getRedis().eval(STORE_TAGGED_CACHE_SCRIPT, {
            keys: [key, tagIndexKey(key), lockKey, ...redisTags],
            arguments: [
              cacheRecord.value,
              String(cacheRecord.redisTtlSeconds),
              lockGeneration,
            ],
          });
          storedInRedis = Number(storeResult) === 1;
        } else {
          const storeResult = await getRedis().eval(
            STORE_CACHE_IF_LOCK_OWNER_SCRIPT,
            {
              keys: [key, lockKey],
              arguments: [
                cacheRecord.value,
                String(cacheRecord.redisTtlSeconds),
                lockGeneration,
              ],
            },
          );
          storedInRedis = Number(storeResult) === 1;
        }
        noteRedisSuccess();
      } catch (error) {
        // The source fetch already succeeded, so return it rather than turning
        // a cache write failure into an API failure or fetching the DB twice.
        noteRedisFailure(error);
      }
      // Redis decides whether this generation still owns the write. In
      // particular, don't let a stale fill repopulate L1 if it lost its lock.
      if (storedInRedis && !flight.invalidated) {
        writeL1(
          key,
          freshData,
          Buffer.byteLength(raw),
          effectiveTtlSeconds,
          tags,
          isNegativeCacheValue ? 0 : staleWhileRevalidateMs,
          cacheRecord.freshUntil,
          cacheRecord.staleUntil,
        );
      }
      return freshData;
    } finally {
      await releaseLock(lockKey, lockGeneration, key, tags).then(
        noteRedisSuccess,
        noteRedisFailure,
      );
    }
  })().finally(() => {
    if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
  });

  flight.promise = request;
  inFlight.set(flightKey, flight);
  return request;
};

const loadCachedValue = async <T>(
  options: CacheLoadOptions<T>,
  signal?: AbortSignal,
): Promise<T> => {
  signal?.throwIfAborted();

  const local = readL1<T>(options.key);
  if (local.hit) {
    if (local.isStale && local.shouldRefresh) {
      // SWR is opt-in at the call site. Keep serving the bounded stale value
      // while one shared refresh checks Redis and, on an L2 miss, MongoDB.
      void startCacheLoad(options).catch((error: unknown) => {
        console.warn("Background L1 cache refresh failed", error);
      });
    }
    return local.value;
  }

  return waitForPromise(startCacheLoad(options), signal);
};

@Injectable()
export class CacheService implements OnModuleInit {
  constructor(
    @Inject(REDIS_CLIENT)
    redisConnection: RedisProvider,
    @Inject(PUBSUB_REDIS_CLIENT)
    pubSubConnection: PubSubRedisProvider,
  ) {
    // The process-local L1 and single-flight maps are intentionally shared by
    // the Nest provider and the standalone worker/script compatibility facade.
    redis = redisConnection;
    pubSub = pubSubConnection;
  }

  onModuleInit() {
    subscribeToInvalidations();
  }

  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600,
    signal?: AbortSignal,
    staleWhileRevalidateMs = 0,
  ): Promise<T> {
    return loadCachedValue(
      {
        key,
        fetchFn,
        ttl,
        staleWhileRevalidateMs,
        encode: JSON.stringify,
        decode: JSON.parse,
        shouldCache: (value) => value !== null && value !== undefined,
      },
      signal,
    );
  }

  async delete(key: string) {
    invalidateL1Key(key);
    let result = 0;
    if (shouldBypassRedis()) {
      enqueuePendingInvalidation({ kind: "key", value: key });
    } else {
      try {
        result = Number(
          await getRedis().eval(DELETE_CACHE_KEYS_SCRIPT, {
            keys: [key],
            arguments: [CACHE_TAG_INDEX_PREFIX, CACHE_FILL_LOCK_PREFIX],
          }),
        );
        noteRedisSuccess();
      } catch (error) {
        noteRedisFailure(error);
        enqueuePendingInvalidation({ kind: "key", value: key });
      }
    }
    await publishInvalidation({ type: "key", value: key });
    return result;
  }

  async getTracker(key: string) {
    // Tracker versions are invalidation state, not ordinary cache data. Always
    // read Redis so another instance's INCR is visible immediately; the Lua
    // script also initializes a missing tracker without a GET/SET race.
    if (shouldBypassRedis()) return advanceOfflineTrackerVersion(key);
    try {
      const version = (await getRedis().eval(GET_OR_CREATE_TRACKER_SCRIPT, {
        keys: [key],
        arguments: [],
      })) as string;
      noteRedisSuccess();
      offlineTrackerVersions.delete(key);
      return version;
    } catch (error) {
      noteRedisFailure(error);
      return advanceOfflineTrackerVersion(key);
    }
  }

  async invalidateGetTracker(key: string) {
    invalidateL1Key(key);
    let newVersion: number | undefined;
    if (shouldBypassRedis()) {
      advanceOfflineTrackerVersion(key);
      enqueuePendingInvalidation({ kind: "tracker", value: key });
    } else {
      try {
        newVersion = await getRedis().incr(key);
        noteRedisSuccess();
        offlineTrackerVersions.delete(key);
      } catch (error) {
        noteRedisFailure(error);
        advanceOfflineTrackerVersion(key);
        enqueuePendingInvalidation({ kind: "tracker", value: key });
      }
    }
    await publishInvalidation({ type: "key", value: key });
    return newVersion;
  }

  async getOrSetWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
    signal?: AbortSignal,
    staleWhileRevalidateMs = 0,
    negativeCacheTtlSeconds?: number,
  ): Promise<T> {
    return loadCachedValue(
      {
        key,
        fetchFn,
        tags,
        ttl,
        staleWhileRevalidateMs,
        ...(negativeCacheTtlSeconds === undefined
          ? {}
          : { negativeCacheTtlSeconds }),
        encode: JSON.stringify,
        decode: JSON.parse,
        shouldCache: (value) => value !== null && value !== undefined,
      },
      signal,
    );
  }

  async getOrSetRawWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
    formatWrapper?: (data: T) => unknown,
    signal?: AbortSignal,
    staleWhileRevalidateMs = 0,
  ): Promise<string> {
    return loadCachedValue(
      {
        key,
        ttl,
        tags,
        staleWhileRevalidateMs,
        fetchFn: async () => {
          const freshData = await fetchFn();
          if (freshData === null || freshData === undefined) return "";
          const payload = formatWrapper ? formatWrapper(freshData) : freshData;
          return typeof payload === "string"
            ? payload
            : JSON.stringify(payload);
        },
        encode: (value) => value,
        decode: (value) => value,
        shouldCache: (value) => value.length > 0,
      },
      signal,
    );
  }

  async invalidateTag(tags: string[]) {
    const tagKeys = tags.map(tagName);
    for (const tagKey of tagKeys) removeL1ByTag(tagKey);
    if (tagKeys.length === 0) return;
    if (shouldBypassRedis()) {
      for (const tag of tags) enqueuePendingInvalidation({ kind: "tag", value: tag });
    } else {
      try {
        // Read new sorted-set indexes plus legacy set keys during the v1 -> v2
        // storage migration. The script also revokes active tagged fills.
        const redisTagKeys = tagKeys.flatMap((tagKey) => [
          tagSetKey(tagKey),
          tagKey,
        ]);
        const activeFillKeys = tags.map((tag) => tagFillKey(tagName(tag)));
        const removedKeys = (await getRedis().eval(INVALIDATE_TAGS_SCRIPT, {
          keys: [...redisTagKeys, ...activeFillKeys],
          arguments: [
            CACHE_TAG_INDEX_PREFIX,
            CACHE_FILL_LOCK_PREFIX,
            String(redisTagKeys.length),
          ],
        })) as string[];
        noteRedisSuccess();
        for (const key of removedKeys) removeL1Key(key);
      } catch (error) {
        noteRedisFailure(error);
        for (const tag of tags) {
          enqueuePendingInvalidation({ kind: "tag", value: tag });
        }
      }
    }
    await Promise.all(
      tagKeys.map((tagKey) =>
        publishInvalidation({ type: "tag-prefix", value: tagKey }),
      ),
    );
  }

  async writeThrough<T>(
    key: string,
    dbAction: () => Promise<T>,
    ttl: number = 3600,
    tags: string[] = [],
  ) {
    const result = await dbAction();
    invalidateL1Key(key);
    const distinctTags = [...new Set(tags.map(tagName))];
    const redisTagKeys = distinctTags.map(tagSetKey);
    const activeFillKeys = distinctTags.map(tagFillKey);
    if (shouldBypassRedis()) {
      enqueuePendingInvalidation({ kind: "key", value: key });
    } else {
      try {
        const raw = JSON.stringify(result);
        const storedGeneration = await getRedis().eval(
          WRITE_THROUGH_CACHE_SCRIPT,
          {
            keys: [
              key,
              tagIndexKey(key),
              `${CACHE_FILL_LOCK_PREFIX}${key}`,
              CACHE_FILL_GENERATION_KEY,
              ...redisTagKeys,
              ...activeFillKeys,
            ],
            arguments: [
              raw,
              String(ttl),
              CACHE_TAG_INDEX_PREFIX,
              String(LOCK_TTL_MS),
              key,
              String(redisTagKeys.length),
            ],
          },
        );
        noteRedisSuccess();

        // Redis has installed the new generation and value atomically.
        const generation = String(storedGeneration);
        writeL1(key, result, Buffer.byteLength(raw), ttl, tags);
        await releaseLock(
          `${CACHE_FILL_LOCK_PREFIX}${key}`,
          generation,
          key,
          tags,
        ).then(noteRedisSuccess, noteRedisFailure);
      } catch (error) {
        // The database action already committed. Do not report a failed mutation
        // because its cache write failed; evict locally and retry invalidation.
        noteRedisFailure(error);
        enqueuePendingInvalidation({ kind: "key", value: key });
      }
    }
    await publishInvalidation({ type: "key", value: key });
    return result;
  }
}

/**
 * Keyspace scans are intentionally kept out of CacheService, which is injected
 * into request-path modules. Retrieve this provider only from maintenance jobs.
 */
@Injectable()
export class CacheMaintenanceService {
  async deletePatternForMaintenance(pattern: string) {
    let batch: string[] = [];
    const flushBatch = async () => {
      if (batch.length === 0) return;
      const keys = batch;
      batch = [];
      await getRedis().eval(DELETE_CACHE_KEYS_SCRIPT, {
        keys,
        arguments: [CACHE_TAG_INDEX_PREFIX, CACHE_FILL_LOCK_PREFIX],
      });
      await publishInvalidation({ type: "keys-batch", value: keys });
    };

    for await (const key of getRedis().scanIterator({
      TYPE: "string",
      MATCH: pattern,
    })) {
      const normalizedKey = key as unknown as string;
      // Maintenance patterns may be broad (for example `cache:*`). Never
      // delete the monotonic fence counter or internal owner locks directly;
      // deleting cache entries below revokes their corresponding locks.
      if (
        normalizedKey === CACHE_FILL_GENERATION_KEY ||
        normalizedKey.startsWith(CACHE_FILL_LOCK_PREFIX)
      ) {
        continue;
      }
      invalidateL1Key(normalizedKey);
      batch.push(normalizedKey);
      if (batch.length >= MAX_INVALIDATION_BATCH_SIZE) await flushBatch();
    }
    await flushBatch();
  }
}
