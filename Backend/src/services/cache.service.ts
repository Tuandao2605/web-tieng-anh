import { randomUUID } from "node:crypto";
import { pubSubRedis, redisClient } from "../utils/redis";

const redis = redisClient.getInstance();

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
const LOCK_TTL_MS = positiveNumberFromEnv(
  process.env.CACHE_LOCK_TTL_MS,
  10_000,
);
const LOCK_WAIT_MS = positiveNumberFromEnv(
  process.env.CACHE_LOCK_WAIT_MS,
  LOCK_TTL_MS + 500,
);
const INVALIDATION_CHANNEL = "cache:l1:invalidate:v1";
const INSTANCE_ID = `${process.pid}:${randomUUID()}`;
const INVALIDATE_TAGS_SCRIPT = `
local cache_keys = {}
local seen = {}

for _, tag_key in ipairs(KEYS) do
  local members = redis.call("SMEMBERS", tag_key)
  for _, cache_key in ipairs(members) do
    if not seen[cache_key] then
      seen[cache_key] = true
      table.insert(cache_keys, cache_key)
    end
  end
end

for _, cache_key in ipairs(cache_keys) do
  redis.call("UNLINK", cache_key)
end
for _, tag_key in ipairs(KEYS) do
  redis.call("UNLINK", tag_key)
end

return cache_keys
`;

type L1Entry = {
  value: unknown;
  expiresAt: number;
  size: number;
  tags: string[];
};

type L1InvalidationMessage =
  | { source: string; type: "key"; value: string }
  | { source: string; type: "tag-prefix"; value: string };

type CacheLoadOptions<T> = {
  key: string;
  fetchFn: () => Promise<T>;
  ttl: number;
  tags?: string[];
  encode: (value: T) => string;
  decode: (raw: string) => T;
  shouldCache?: (value: T) => boolean;
};

const l1Cache = new Map<string, L1Entry>();
const l1TagKeys = new Map<string, Set<string>>();
let l1Bytes = 0;

// Prevents a thundering herd inside one Node.js process.
const inFlight = new Map<string, Promise<unknown>>();

const tagName = (tag: string) => `tag:${tag}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const readL1 = <T>(key: string): { hit: true; value: T } | { hit: false } => {
  const entry = l1Cache.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt <= Date.now()) {
    removeL1Key(key);
    return { hit: false };
  }

  // Refresh insertion order to make the bounded map an LRU cache.
  l1Cache.delete(key);
  l1Cache.set(key, entry);
  return { hit: true, value: entry.value as T };
};

const writeL1 = <T>(
  key: string,
  value: T,
  encodedSize: number,
  ttlSeconds: number,
  tags: string[] = [],
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
  l1Cache.set(key, {
    value,
    expiresAt: Date.now() + jitteredTtlMs,
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

const removeL1ByTagPrefix = (prefix: string) => {
  const keysToDelete = new Set<string>();
  for (const [tag, keys] of l1TagKeys) {
    if (tag.startsWith(prefix)) {
      for (const key of keys) keysToDelete.add(key);
    }
  }
  for (const key of keysToDelete) removeL1Key(key);
};

const publishInvalidation = async (
  message: Omit<L1InvalidationMessage, "source">,
) => {
  const publisher = pubSubRedis.getInstance().pubClient;
  if (!publisher) return;
  try {
    await publisher.publish(
      INVALIDATION_CHANNEL,
      JSON.stringify({ ...message, source: INSTANCE_ID }),
    );
  } catch (error) {
    // L1's short TTL is the fallback if Pub/Sub is temporarily unavailable.
    console.warn("Unable to publish L1 cache invalidation", error);
  }
};

const subscribeToInvalidations = () => {
  const subscriber = pubSubRedis.getInstance().subClient;
  if (!subscriber) return;

  void subscriber
    .subscribe(INVALIDATION_CHANNEL, (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage) as L1InvalidationMessage;
        if (message.source === INSTANCE_ID) return;
        if (message.type === "key") removeL1Key(message.value);
        if (message.type === "tag-prefix") {
          removeL1ByTagPrefix(message.value);
        }
      } catch (error) {
        console.warn("Ignoring invalid L1 cache invalidation message", error);
      }
    })
    .catch((error) => {
      console.warn("Unable to subscribe to L1 cache invalidations", error);
    });
};

subscribeToInvalidations();

const releaseLock = async (lockKey: string, token: string) => {
  await redis.eval(
    `if redis.call("GET", KEYS[1]) == ARGV[1] then
       return redis.call("DEL", KEYS[1])
     end
     return 0`,
    { keys: [lockKey], arguments: [token] },
  );
};

const waitForL2Value = async (key: string, lockKey: string) => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let delayMs = 20;
  while (Date.now() < deadline) {
    // Jitter prevents waiting instances from polling Redis in lockstep.
    await sleep(delayMs + Math.floor(Math.random() * 20));
    const values = await redis.mGet([key, lockKey]);
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

const loadCachedValue = async <T>(
  options: CacheLoadOptions<T>,
  signal?: AbortSignal,
): Promise<T> => {
  signal?.throwIfAborted();
  const { key, fetchFn, ttl, tags = [], encode, decode } = options;
  const shouldCache = options.shouldCache ?? (() => true);

  const local = readL1<T>(key);
  if (local.hit) return local.value;

  const existingFlight = inFlight.get(key);
  if (existingFlight) {
    return waitForPromise(existingFlight as Promise<T>, signal);
  }

  const request = (async () => {
    // The Redis lookup itself is inside single-flight. When L1 expires under
    // heavy concurrency, one worker emits one L2 GET instead of one per request.
    const cached = await redis.get(key);
    if (cached !== null) {
      const decoded = decode(cached);
      writeL1(key, decoded, Buffer.byteLength(cached), ttl, tags);
      return decoded;
    }

    const lockKey = `cache:fill-lock:${key}`;
    const lockToken = randomUUID();
    let ownsLock =
      (await redis.set(lockKey, lockToken, { NX: true, PX: LOCK_TTL_MS })) ===
      "OK";

    if (!ownsLock) {
      const remoteValue = await waitForL2Value(key, lockKey);
      if (remoteValue !== null) {
        const decoded = decode(remoteValue);
        writeL1(key, decoded, Buffer.byteLength(remoteValue), ttl, tags);
        return decoded;
      }

      // The first owner may have failed. Make one takeover attempt after its
      // lock/wait period instead of letting every instance query MongoDB.
      ownsLock =
        (await redis.set(lockKey, lockToken, { NX: true, PX: LOCK_TTL_MS })) ===
        "OK";
    }

    try {
      const freshData = await fetchFn();
      if (!shouldCache(freshData)) return freshData;

      const raw = encode(freshData);
      if (tags.length > 0) {
        const multi = redis.multi();
        multi.set(key, raw, { EX: ttl });
        for (const tag of tags.map(tagName)) {
          multi.sAdd(tag, key);
          multi.expire(tag, ttl);
        }
        await multi.exec();
      } else {
        await redis.set(key, raw, { EX: ttl });
      }
      writeL1(key, freshData, Buffer.byteLength(raw), ttl, tags);
      return freshData;
    } finally {
      if (ownsLock) {
        await releaseLock(lockKey, lockToken).catch(() => undefined);
      }
    }
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, request);
  return waitForPromise(request, signal);
};

export const cacheService = {
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600,
    signal?: AbortSignal,
  ): Promise<T> {
    return loadCachedValue(
      {
        key,
        fetchFn,
        ttl,
        encode: JSON.stringify,
        decode: JSON.parse,
        shouldCache: (value) => value !== null && value !== undefined,
      },
      signal,
    );
  },

  async delete(key: string) {
    removeL1Key(key);
    const result = await redis.unlink(key);
    await publishInvalidation({ type: "key", value: key });
    return result;
  },

  async deletePattern(pattern: string) {
    let batch: string[] = [];
    for await (const key of redis.scanIterator({
      TYPE: "string",
      MATCH: pattern,
    })) {
      const normalizedKey = key as unknown as string;
      removeL1Key(normalizedKey);
      batch.push(normalizedKey);
      if (batch.length >= 500) {
        await redis.unlink(batch);
        await Promise.all(
          batch.map((value) => publishInvalidation({ type: "key", value })),
        );
        batch = [];
      }
    }
    if (batch.length > 0) {
      await redis.unlink(batch);
      await Promise.all(
        batch.map((value) => publishInvalidation({ type: "key", value })),
      );
    }
  },

  async getTracker(key: string) {
    const local = readL1<string>(key);
    if (local.hit) return local.value;

    const flightKey = `tracker:${key}`;
    const existingFlight = inFlight.get(flightKey);
    if (existingFlight) return existingFlight as Promise<string>;

    const request = (async () => {
      await redis.set(key, "1", { NX: true });
      const version = await redis.get(key);
      const normalizedVersion = version ?? "1";
      writeL1(
        key,
        normalizedVersion,
        Buffer.byteLength(normalizedVersion),
        Math.ceil(L1_TTL_MS / 1_000),
      );
      return normalizedVersion;
    })().finally(() => {
      inFlight.delete(flightKey);
    });
    inFlight.set(flightKey, request);
    return request;
  },

  async invalidateGetTracker(key: string) {
    const newVersion = await redis.incr(key);
    const normalizedVersion = String(newVersion);
    writeL1(
      key,
      normalizedVersion,
      Buffer.byteLength(normalizedVersion),
      Math.ceil(L1_TTL_MS / 1_000),
    );
    await publishInvalidation({ type: "key", value: key });
    return newVersion;
  },

  async getOrSetWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
    signal?: AbortSignal,
  ): Promise<T> {
    return loadCachedValue(
      {
        key,
        fetchFn,
        tags,
        ttl,
        encode: JSON.stringify,
        decode: JSON.parse,
        shouldCache: (value) => value !== null && value !== undefined,
      },
      signal,
    );
  },

  async getOrSetRawWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
    formatWrapper?: (data: T) => unknown,
    signal?: AbortSignal,
  ): Promise<string> {
    return loadCachedValue(
      {
        key,
        ttl,
        tags,
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
  },

  async invalidateTag(tags: string[]) {
    const tagKeys = tags.map(tagName);
    for (const tagKey of tagKeys) removeL1ByTagPrefix(tagKey);
    if (tagKeys.length === 0) return;

    // One atomic Redis command reads the exact tag sets and unlinks their
    // members. There is no keyspace SCAN and no fill/invalidation race between
    // separate SMEMBERS and UNLINK round-trips.
    const removedKeys = (await redis.eval(INVALIDATE_TAGS_SCRIPT, {
      keys: tagKeys,
      arguments: [],
    })) as string[];
    for (const key of removedKeys) {
      removeL1Key(key);
    }
    await Promise.all(
      tagKeys.map((tagKey) =>
        publishInvalidation({ type: "tag-prefix", value: tagKey }),
      ),
    );
  },

  async writeThrough<T>(
    key: string,
    dbAction: () => Promise<T>,
    ttl: number = 3600,
  ) {
    const result = await dbAction();
    const raw = JSON.stringify(result);
    await redis.set(key, raw, { EX: ttl });
    writeL1(key, result, Buffer.byteLength(raw), ttl);
    await publishInvalidation({ type: "key", value: key });
    return result;
  },
};
