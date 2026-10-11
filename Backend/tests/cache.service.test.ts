import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import {
  CacheMaintenanceService,
  CacheService,
} from "../src/modules/cache/cache.service";
import type {
  PubSubRedisProvider,
  RedisProvider,
} from "../src/config/infrastructure.tokens";

const makeCacheHarness = (keysToScan: string[] = []) => {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const tagScores = new Map<string, Map<string, number>>();
  const tagFills = new Map<string, Map<string, string>>();
  const getCalls: string[] = [];
  let trackerReadCalls = 0;
  let failRedisReads = false;
  let failRedisIncr = false;
  const failEvalScripts = new Set<string>();
  const setCalls: { key: string; options?: { NX?: boolean; EX?: number; PX?: number } }[] = [];
  const published: { channel: string; payload: string }[] = [];
  let onMessage: ((payload: string) => void) | undefined;
  const deletedBatches: string[][] = [];
  let mGetOverride:
    | ((keys: string[]) => Promise<(string | null)[]> | (string | null)[])
    | undefined;

  const removeCacheKey = (key: string) => {
    const indexKey = `cache:tag-index:${key}`;
    for (const tagKey of sets.get(indexKey) ?? []) {
      sets.get(tagKey)?.delete(key);
      tagScores.get(tagKey)?.delete(key);
    }
    sets.delete(indexKey);
    return values.delete(key) ? 1 : 0;
  };

  const redis = {
    async get(key: string) {
      getCalls.push(key);
      if (failRedisReads) throw new Error("Redis connection unavailable");
      return values.get(key) ?? null;
    },
    async set(
      key: string,
      value: string,
      options?: { NX?: boolean; EX?: number; PX?: number },
    ) {
      setCalls.push({ key, ...(options ? { options } : {}) });
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async unlink(keys: string | string[]) {
      const batch = Array.isArray(keys) ? keys : [keys];
      deletedBatches.push(batch);
      let deleted = 0;
      for (const key of batch) {
        if (values.delete(key)) deleted += 1;
      }
      return deleted;
    },
    async mGet(keys: string[]) {
      if (mGetOverride) return mGetOverride(keys);
      return keys.map((key) => values.get(key) ?? null);
    },
    async incr(key: string) {
      if (failRedisIncr) throw new Error("Redis INCR unavailable");
      const value = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(value));
      return value;
    },
    async eval(
      script: string,
      options: { keys: string[]; arguments: string[] },
    ) {
      const failedScript = [...failEvalScripts].find((marker) =>
        script.includes(marker),
      );
      if (failedScript) throw new Error(`Redis script failed: ${failedScript}`);
      if (script.includes("GET_OR_CREATE_TRACKER_V1")) {
        trackerReadCalls += 1;
        const key = options.keys[0];
        if (!key) return null;
        const current = values.get(key);
        if (current !== undefined) return current;
        values.set(key, "1");
        return "1";
      }
      if (script.includes("ACQUIRE_CACHE_FILL_LOCK_V1")) {
        const [lockKey, generationKey, ...activeFillKeys] = options.keys;
        if (!lockKey || !generationKey || values.has(lockKey)) return null;
        const generation = Number(values.get(generationKey) ?? 0) + 1;
        values.set(generationKey, String(generation));
        values.set(lockKey, String(generation));
        const key = options.arguments[1];
        if (key) {
          for (const activeFillKey of activeFillKeys) {
            const fills = tagFills.get(activeFillKey) ?? new Map<string, string>();
            fills.set(key, String(generation));
            tagFills.set(activeFillKey, fills);
          }
        }
        return String(generation);
      }
      if (script.includes("RELEASE_CACHE_FILL_LOCK_V1")) {
        const [lockKey, ...activeFillKeys] = options.keys;
        const [generation, key] = options.arguments;
        if (lockKey && values.get(lockKey) === generation) values.delete(lockKey);
        for (const activeFillKey of activeFillKeys) {
          const fills = tagFills.get(activeFillKey);
          if (key && fills && fills.get(key) === generation) fills.delete(key);
        }
        return 1;
      }
      if (script.includes("STORE_TAGGED_CACHE_V2")) {
        const [key, indexKey, lockKey, ...tagKeys] = options.keys;
        const [value, ttlRaw, generation] = options.arguments;
        if (!key || !indexKey || value === undefined) return 0;
        if (!lockKey || values.get(lockKey) !== generation) return 0;
        const ttlSeconds = Number(ttlRaw ?? 0);
        setCalls.push({ key, options: { EX: ttlSeconds } });
        removeCacheKey(key);
        values.set(key, value);
        for (const tagKey of tagKeys) {
          const scores = tagScores.get(tagKey) ?? new Map<string, number>();
          for (const [member, expiry] of scores) {
            if (expiry <= Date.now()) scores.delete(member);
          }
          scores.set(key, Date.now() + ttlSeconds * 1_000);
          tagScores.set(tagKey, scores);
          sets.set(tagKey, new Set(scores.keys()));
          const keyTags = sets.get(indexKey) ?? new Set<string>();
          keyTags.add(tagKey);
          sets.set(indexKey, keyTags);
        }
        return 1;
      }
      if (script.includes("STORE_CACHE_IF_LOCK_OWNER_V1")) {
        const [key, lockKey] = options.keys;
        const [value, _ttl, generation] = options.arguments;
        if (!key || !lockKey || value === undefined || values.get(lockKey) !== generation) {
          return 0;
        }
        setCalls.push({ key, options: { EX: Number(_ttl) } });
        values.set(key, value);
        return 1;
      }
      if (script.includes("WRITE_THROUGH_CACHE_V1")) {
        const [key, indexKey, lockKey, generationKey, ...tagAndFillKeys] =
          options.keys;
        const [value, ttlRaw, , , fillField, tagCountRaw] = options.arguments;
        if (!key || !indexKey || !lockKey || !generationKey || value === undefined) {
          return 0;
        }
        const tagCount = Number(tagCountRaw ?? 0);
        const tagKeys = tagAndFillKeys.slice(0, tagCount);
        const activeFillKeys = tagAndFillKeys.slice(tagCount);
        const generation = Number(values.get(generationKey) ?? 0) + 1;
        const generationValue = String(generation);
        values.set(generationKey, generationValue);
        values.set(lockKey, generationValue);
        for (const activeFillKey of activeFillKeys) {
          const fills = tagFills.get(activeFillKey) ?? new Map<string, string>();
          if (fillField) fills.set(fillField, generationValue);
          tagFills.set(activeFillKey, fills);
        }
        removeCacheKey(key);
        values.set(key, value);
        const ttlSeconds = Number(ttlRaw ?? 0);
        for (const tagKey of tagKeys) {
          const scores = tagScores.get(tagKey) ?? new Map<string, number>();
          scores.set(key, Date.now() + (ttlSeconds + 1) * 1_000);
          tagScores.set(tagKey, scores);
          sets.set(tagKey, new Set(scores.keys()));
          const keyTags = sets.get(indexKey) ?? new Set<string>();
          keyTags.add(tagKey);
          sets.set(indexKey, keyTags);
        }
        return generationValue;
      }
      if (script.includes("INVALIDATE_TAGS_V2")) {
        const removedKeys = new Set<string>();
        const tagSetKeyCount = Number(options.arguments[2] ?? 0);
        const tagSetKeys = options.keys.slice(0, tagSetKeyCount);
        const activeFillKeys = options.keys.slice(tagSetKeyCount);
        for (const tagKey of tagSetKeys) {
          const scores = tagScores.get(tagKey);
          for (const [member, expiry] of scores ?? []) {
            if (expiry <= Date.now()) scores?.delete(member);
          }
          const members = sets.get(tagKey) ?? new Set<string>();
          for (const key of members) {
            if (values.has(key)) removedKeys.add(key);
            else members.delete(key);
          }
        }
        for (const key of removedKeys) {
          removeCacheKey(key);
          values.delete(`cache:fill-lock:${key}`);
        }
        for (const activeFillKey of activeFillKeys) {
          for (const [key, generation] of tagFills.get(activeFillKey) ?? []) {
            const lockKey = `cache:fill-lock:${key}`;
            if (values.get(lockKey) === generation) values.delete(lockKey);
          }
          tagFills.delete(activeFillKey);
        }
        for (const tagKey of tagSetKeys) {
          sets.delete(tagKey);
          tagScores.delete(tagKey);
        }
        return [...removedKeys];
      }
      if (script.includes("DELETE_CACHE_KEYS_V1")) {
        const keys = [...options.keys];
        let deleted = 0;
        for (const key of keys) {
          deleted += removeCacheKey(key);
          values.delete(`cache:fill-lock:${key}`);
        }
        deletedBatches.push(keys);
        return deleted;
      }
      values.delete(options.keys[0] ?? "");
      return 1;
    },
    async *scanIterator() {
      for (const key of keysToScan) yield key;
    },
  } as unknown as RedisProvider;

  const pubSub = {
    pubClient: {
      async publish(channel: string, payload: string) {
        published.push({ channel, payload });
        return 1;
      },
    },
    subClient: {
      async subscribe(_channel: string, listener: (payload: string) => void) {
        onMessage = listener;
      },
    },
  } as unknown as PubSubRedisProvider;

  const cache = new CacheService(redis, pubSub);
  const maintenance = new CacheMaintenanceService();
  return {
    cache,
    maintenance,
    values,
    sets,
    tagScores,
    tagFills,
    getCalls,
    get trackerReadCalls() {
      return trackerReadCalls;
    },
    failRedisReads(value: boolean) {
      failRedisReads = value;
    },
    failRedisIncr(value: boolean) {
      failRedisIncr = value;
    },
    failEvalScript(marker: string, value: boolean) {
      if (value) failEvalScripts.add(marker);
      else failEvalScripts.delete(marker);
    },
    setCalls,
    published,
    deletedBatches,
    receive(payload: string) {
      onMessage?.(payload);
    },
    startSubscriber() {
      cache.onModuleInit();
    },
    setMGetOverride(
      handler: (keys: string[]) => Promise<(string | null)[]> | (string | null)[],
    ) {
      mGetOverride = handler;
    },
    simulateRemoteKeyInvalidation(key: string) {
      removeCacheKey(key);
      values.delete(`cache:fill-lock:${key}`);
    },
    simulateRemoteTagInvalidation(tag: string) {
      const tagKey = `tag:${tag}`;
      const tagSetKeys = [`cache:tag-set:v2:${tagKey}`, tagKey];
      for (const tagSet of tagSetKeys) {
        for (const key of sets.get(tagSet) ?? []) {
          removeCacheKey(key);
          values.delete(`cache:fill-lock:${key}`);
        }
        sets.delete(tagSet);
      }
      const activeFillKey = `cache:tag-fills:v1:${tagKey}`;
      for (const [key, generation] of tagFills.get(activeFillKey) ?? []) {
        const lockKey = `cache:fill-lock:${key}`;
        if (values.get(lockKey) === generation) values.delete(lockKey);
      }
      tagFills.delete(activeFillKey);
    },
  };
};

test("tracker versions always read Redis and observe remote increments immediately", async () => {
  const harness = makeCacheHarness();
  const key = `cache:tracker:${Date.now()}:${Math.random()}`;

  assert.equal(await harness.cache.getTracker(key), "1");
  harness.values.set(key, "2"); // Simulate another instance incrementing it.
  assert.equal(await harness.cache.getTracker(key), "2");
  assert.equal(harness.trackerReadCalls, 2);
});

test("deletePattern broadcasts one invalidation per 500-key batch", async () => {
  const keys = Array.from({ length: 1_205 }, (_, index) => `pattern:${index}`);
  const harness = makeCacheHarness(keys);

  await harness.maintenance.deletePatternForMaintenance("pattern:*");

  const invalidations = harness.published.map(({ payload }) =>
    JSON.parse(payload) as { type: string; value: string[] },
  );
  assert.deepEqual(
    invalidations.map((message) => message.value.length),
    [500, 500, 205],
  );
  assert.ok(invalidations.every((message) => message.type === "keys-batch"));
  assert.deepEqual(
    harness.deletedBatches.map((batch) => batch.length),
    [500, 500, 205],
  );
  assert.equal(harness.published.length, 3);
});

test("subscriber invalidates every L1 key in a keys-batch message", async () => {
  const harness = makeCacheHarness();
  harness.startSubscriber();

  const key = `cache:batch-invalidation:${Date.now()}`;
  let fetches = 0;
  const fetchValue = async () => `fresh-${++fetches}`;
  assert.equal(await harness.cache.getOrSet(key, fetchValue), "fresh-1");

  // Simulate another process deleting the L2 value without touching this L1.
  harness.values.delete(key);
  // The sender ignores its own source id, so emulate another app instance.
  harness.receive(
    JSON.stringify({
      source: "remote-instance",
      type: "keys-batch",
      value: [key],
    }),
  );

  assert.equal(await harness.cache.getOrSet(key, fetchValue), "fresh-2");
  assert.equal(fetches, 2);
});

test("tag invalidation uses exact matches across L1 and removes tag-set references", async () => {
  const harness = makeCacheHarness();
  const overlappingKey = `cache:tag:user2:${Date.now()}`;
  let overlappingFetches = 0;
  const fetchOverlapping = async () => ++overlappingFetches;
  await harness.cache.getOrSetWithTag(
    overlappingKey,
    fetchOverlapping,
    ["user2"],
  );

  const readsBeforeInvalidation = harness.getCalls.length;
  await harness.cache.invalidateTag(["user"]);
  await harness.cache.getOrSetWithTag(
    overlappingKey,
    fetchOverlapping,
    ["user2"],
  );
  assert.equal(overlappingFetches, 1);
  assert.equal(harness.getCalls.length, readsBeforeInvalidation);

  const deletedKey = `cache:tag-delete:${Date.now()}`;
  await harness.cache.getOrSetWithTag(
    deletedKey,
    async () => "tagged",
    ["alpha", "beta"],
  );
  assert.ok(
    harness.sets.get("cache:tag-set:v2:tag:alpha")?.has(deletedKey),
  );
  assert.ok(
    harness.sets.get("cache:tag-set:v2:tag:beta")?.has(deletedKey),
  );
  await harness.cache.delete(deletedKey);
  assert.equal(
    harness.sets.get("cache:tag-set:v2:tag:alpha")?.has(deletedKey),
    false,
  );
  assert.equal(
    harness.sets.get("cache:tag-set:v2:tag:beta")?.has(deletedKey),
    false,
  );
  assert.equal(
    harness.sets.has(`cache:tag-index:${deletedKey}`),
    false,
  );

  const invalidatedKey = `cache:tag-invalidate:${Date.now()}`;
  await harness.cache.getOrSetWithTag(
    invalidatedKey,
    async () => "tagged",
    ["gamma", "delta"],
  );
  await harness.cache.invalidateTag(["gamma"]);
  assert.equal(harness.values.has(invalidatedKey), false);
  assert.equal(
    harness.sets.get("cache:tag-set:v2:tag:delta")?.has(invalidatedKey),
    false,
  );
  assert.equal(
    harness.sets.has(`cache:tag-index:${invalidatedKey}`),
    false,
  );

  const expiredTagSet = "cache:tag-set:v2:tag:ttl-prune";
  const naturallyExpiredKey = `${invalidatedKey}:expired`;
  harness.sets.set(expiredTagSet, new Set([naturallyExpiredKey]));
  harness.tagScores.set(
    expiredTagSet,
    new Map([[naturallyExpiredKey, Date.now() - 1]]),
  );
  await harness.cache.getOrSetWithTag(
    `${invalidatedKey}:fresh`,
    async () => "fresh",
    ["ttl-prune"],
    30,
  );
  assert.equal(harness.sets.get(expiredTagSet)?.has(naturallyExpiredKey), false);
});

test("cache fill waits for a competing lock owner after takeover loses the race", async () => {
  const harness = makeCacheHarness();
  const key = `cache:takeover-race:${Date.now()}:${Math.random()}`;
  const lockKey = `cache:fill-lock:${key}`;
  harness.values.set(lockKey, "first-owner");

  let injectedCompetingOwner = false;
  harness.setMGetOverride((keys) => {
    assert.deepEqual(keys, [key, lockKey]);
    if (!injectedCompetingOwner) {
      injectedCompetingOwner = true;
      // The first lock owner releases, then another instance wins NX before
      // this request's takeover attempt. Return the just-before-race snapshot.
      harness.values.delete(lockKey);
      harness.values.set(lockKey, "competing-owner");
      setTimeout(() => {
        harness.values.set(key, JSON.stringify("filled-by-competing-owner"));
        harness.values.delete(lockKey);
      }, 5);
      return [null, null];
    }
    return keys.map((redisKey) => harness.values.get(redisKey) ?? null);
  });

  let fetches = 0;
  const value = await harness.cache.getOrSet(key, async () => {
    fetches += 1;
    return "unexpected-db-fetch";
  });

  assert.equal(value, "filled-by-competing-owner");
  assert.equal(fetches, 0);
});

test("Redis fencing prevents a remote key invalidation from being undone by an old fill", async () => {
  const harness = makeCacheHarness();
  const key = `cache:fenced-delete:${Date.now()}:${Math.random()}`;
  const lockKey = `cache:fill-lock:${key}`;
  let beginFetch: (() => void) | undefined;
  let finishFetch: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    beginFetch = resolve;
  });
  const fetchGate = new Promise<void>((resolve) => {
    finishFetch = resolve;
  });

  const oldFill = harness.cache.getOrSet(key, async () => {
    beginFetch?.();
    await fetchGate;
    return "stale-source-value";
  });

  try {
    await fetchStarted;
    assert.match(harness.values.get(lockKey) ?? "", /^[1-9]\d*$/);

    // Emulate another process performing the Redis invalidation while this
    // process misses its Pub/Sub message, so its local flight flag stays false.
    harness.simulateRemoteKeyInvalidation(key);
    finishFetch?.();

    assert.equal(await oldFill, "stale-source-value");
    assert.equal(harness.values.has(key), false);
    assert.equal(
      await harness.cache.getOrSet(key, async () => "fresh-source-value"),
      "fresh-source-value",
    );
  } finally {
    finishFetch?.();
  }
});

test("Redis fencing prevents a remote tag invalidation from committing an active fill", async () => {
  const harness = makeCacheHarness();
  const key = `cache:fenced-tag:${Date.now()}:${Math.random()}`;
  const tag = `fenced-tag-${Date.now()}`;
  const lockKey = `cache:fill-lock:${key}`;
  const activeFillKey = `cache:tag-fills:v1:tag:${tag}`;
  let beginFetch: (() => void) | undefined;
  let finishFetch: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    beginFetch = resolve;
  });
  const fetchGate = new Promise<void>((resolve) => {
    finishFetch = resolve;
  });

  const oldFill = harness.cache.getOrSetWithTag(
    key,
    async () => {
      beginFetch?.();
      await fetchGate;
      return "stale-tagged-value";
    },
    [tag],
  );

  try {
    await fetchStarted;
    assert.equal(harness.tagFills.get(activeFillKey)?.has(key), true);
    harness.simulateRemoteTagInvalidation(tag);
    finishFetch?.();

    assert.equal(await oldFill, "stale-tagged-value");
    assert.equal(harness.values.has(key), false);
    assert.equal(harness.values.has(lockKey), false);
    assert.equal(
      await harness.cache.getOrSetWithTag(
        key,
        async () => "fresh-tagged-value",
        [tag],
      ),
      "fresh-tagged-value",
    );
  } finally {
    finishFetch?.();
  }
});

test("writeThrough uses the same fence and preserves tag membership", async () => {
  const harness = makeCacheHarness();
  const key = `cache:fenced-write-through:${Date.now()}:${Math.random()}`;
  const tag = `write-through-${Date.now()}`;
  const warmKey = `${key}:warm`;
  await harness.cache.writeThrough(
    warmKey,
    async () => "warm-value",
    60,
    [tag],
  );
  assert.equal(harness.values.get(warmKey), JSON.stringify("warm-value"));
  assert.equal(
    harness.sets.get("cache:tag-set:v2:tag:" + tag)?.has(warmKey),
    true,
  );

  let beginFetch: (() => void) | undefined;
  let finishFetch: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    beginFetch = resolve;
  });
  const fetchGate = new Promise<void>((resolve) => {
    finishFetch = resolve;
  });

  const oldFill = harness.cache.getOrSetWithTag(
    key,
    async () => {
      beginFetch?.();
      await fetchGate;
      return "old-value";
    },
    [tag],
  );

  try {
    await fetchStarted;
    const oldGeneration = harness.values.get("cache:fill-generation:v1");
    await harness.cache.writeThrough(
      key,
      async () => "new-value",
      60,
      [tag],
    );
    finishFetch?.();

    assert.equal(await oldFill, "old-value");
    assert.equal(harness.values.get(key), JSON.stringify("new-value"));
    assert.ok(
      Number(harness.values.get("cache:fill-generation:v1")) >
        Number(oldGeneration),
    );
    await harness.cache.invalidateTag([tag]);
    assert.equal(harness.values.has(warmKey), false);
  } finally {
    finishFetch?.();
  }
});

test("L2 SWR serves stale Redis data while refreshing after L1 eviction", async () => {
  const harness = makeCacheHarness();
  const key = `cache:l2-swr:${Date.now()}:${Math.random()}`;
  let fetches = 0;
  let beginRefresh: (() => void) | undefined;
  let finishRefresh: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    beginRefresh = resolve;
  });
  const refreshGate = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  const fetchValue = async () => {
    fetches += 1;
    if (fetches === 1) return "original";
    beginRefresh?.();
    await refreshGate;
    return "updated";
  };

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    assert.equal(
      await harness.cache.getOrSet(key, fetchValue, 1, undefined, 10_000),
      "original",
    );
    const storedRecord = JSON.parse(harness.values.get(key) ?? "null") as {
      __cacheSWR?: number;
      payload?: string;
      freshUntil?: number;
      staleUntil?: number;
    };
    assert.equal(storedRecord.__cacheSWR, 1);
    assert.equal(storedRecord.payload, '"original"');
    assert.ok(storedRecord.staleUntil! > storedRecord.freshUntil!);

    // Exceed the 1,000-entry L1 bound so this key must be recovered from Redis.
    for (let index = 0; index < 1_000; index += 1) {
      await harness.cache.getOrSet(`${key}:filler:${index}`, async () => index);
    }
    now += 1_001;

    assert.equal(
      await harness.cache.getOrSet(key, fetchValue, 1, undefined, 10_000),
      "original",
    );
    await refreshStarted;
    assert.equal(fetches, 2);

    finishRefresh?.();
    // Let the detached refresh finish writing Redis and L1.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      await harness.cache.getOrSet(key, fetchValue, 1, undefined, 10_000),
      "updated",
    );
    assert.equal(fetches, 2);
  } finally {
    Date.now = realNow;
    finishRefresh?.();
  }
});

test("negative cache is opt-in, uses its short TTL, and avoids repeat fetches", async () => {
  const harness = makeCacheHarness();
  const key = `cache:negative:${Date.now()}:${Math.random()}`;
  let fetches = 0;
  const fetchMissing = async () => {
    fetches += 1;
    return null;
  };

  assert.equal(
    await harness.cache.getOrSetWithTag(
      key,
      fetchMissing,
      [],
      3_600,
      undefined,
      0,
      30,
    ),
    null,
  );
  const negativeRecord = JSON.parse(harness.values.get(key) ?? "null") as {
    __cacheNegative?: number;
    expiresAt?: number;
  };
  assert.equal(negativeRecord.__cacheNegative, 1);
  assert.ok(negativeRecord.expiresAt! > Date.now());
  assert.ok(
    harness.setCalls.some(
      (call) => call.key === key && call.options?.EX === 30,
    ),
  );

  // Evict the L1 negative entry; the L2 null still prevents another fetch.
  for (let index = 0; index < 1_000; index += 1) {
    await harness.cache.getOrSet(`${key}:filler:${index}`, async () => index);
  }
  assert.equal(
    await harness.cache.getOrSetWithTag(
      key,
      fetchMissing,
      [],
      3_600,
      undefined,
      0,
      30,
    ),
    null,
  );
  assert.equal(fetches, 1);

  const uncachedKey = `${key}:default`;
  let uncachedFetches = 0;
  const fetchUncachedMissing = async () => {
    uncachedFetches += 1;
    return null;
  };
  await harness.cache.getOrSetWithTag(uncachedKey, fetchUncachedMissing, []);
  await harness.cache.getOrSetWithTag(uncachedKey, fetchUncachedMissing, []);
  assert.equal(uncachedFetches, 2);

  const failingKey = `${key}:failure`;
  let failedFetches = 0;
  const fetchFailure = async () => {
    failedFetches += 1;
    throw new Error("database unavailable");
  };
  await assert.rejects(
    harness.cache.getOrSetWithTag(
      failingKey,
      fetchFailure,
      [],
      3_600,
      undefined,
      0,
      30,
    ),
    /database unavailable/,
  );
  await assert.rejects(
    harness.cache.getOrSetWithTag(
      failingKey,
      fetchFailure,
      [],
      3_600,
      undefined,
      0,
      30,
    ),
    /database unavailable/,
  );
  assert.equal(failedFetches, 2);
});

test("cache invalidation failures do not fail committed mutations and retry after Redis recovers", async () => {
  const harness = makeCacheHarness();
  const key = `cache:mutation-outage:${Date.now()}:${Math.random()}`;
  const tag = `mutation-outage-${Date.now()}`;
  const trackerKey = `cache:tracker:mutation-outage:${Date.now()}`;
  await harness.cache.getOrSetWithTag(key, async () => "old-value", [tag], 30);

  // Exercise a failed tag invalidation while the circuit is closed, then let
  // the in-memory retry queue drain before testing the other failure paths.
  harness.failEvalScript("INVALIDATE_TAGS_V2", true);
  await assert.doesNotReject(harness.cache.invalidateTag([tag]));
  harness.failEvalScript("INVALIDATE_TAGS_V2", false);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(harness.values.has(key), false);

  let databaseCommitted = false;
  harness.failEvalScript("WRITE_THROUGH_CACHE_V1", true);
  const result = await harness.cache.writeThrough(
    key,
    async () => {
      databaseCommitted = true;
      return "database-value";
    },
    30,
    [tag],
  );
  harness.failEvalScript("WRITE_THROUGH_CACHE_V1", false);
  assert.equal(databaseCommitted, true);
  assert.equal(result, "database-value");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(harness.values.has(key), false);

  const offlineVersionBeforeMutation = await harness.cache.getTracker(trackerKey);
  harness.failRedisIncr(true);
  assert.equal(await harness.cache.invalidateGetTracker(trackerKey), undefined);
  const offlineVersionAfterMutation = await harness.cache.getTracker(trackerKey);
  assert.ok(Number(offlineVersionAfterMutation) > Number(offlineVersionBeforeMutation));
  harness.failRedisIncr(false);

  // The tracker INCR is also retried after Redis recovers.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(harness.values.get(trackerKey), "2");
});

test("Redis GET outage falls back to DB without cache-induced 500s and caps concurrency", async () => {
  const harness = makeCacheHarness();
  harness.failRedisReads(true);

  let activeFetches = 0;
  let startedFetches = 0;
  let peakFetches = 0;
  let releaseFetches: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetches = resolve;
  });
  let allStarted: (() => void) | undefined;
  const allStartedPromise = new Promise<void>((resolve) => {
    allStarted = resolve;
  });

  const requests = Array.from({ length: 60 }, (_, index) =>
    harness.cache.getOrSet(`cache:redis-outage:${index}`, async () => {
      activeFetches += 1;
      startedFetches += 1;
      peakFetches = Math.max(peakFetches, activeFetches);
      if (startedFetches === 50) allStarted?.();
      await fetchGate;
      activeFetches -= 1;
      return `db-value-${index}`;
    }),
  );

  try {
    await allStartedPromise;
    assert.equal(startedFetches, 50);
    assert.equal(peakFetches, 50);
  } finally {
    releaseFetches?.();
  }

  const results = await Promise.allSettled(requests);
  assert.ok(harness.getCalls.length > 0);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 50);
  const firstResult = results[0];
  assert.equal(firstResult?.status, "fulfilled");
  if (firstResult?.status === "fulfilled") {
    assert.equal(firstResult.value, "db-value-0");
  }
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.equal(rejected.length, 10);
  assert.ok(
    rejected.every((result) =>
      result.reason instanceof Error && "getStatus" in result.reason &&
      typeof result.reason.getStatus === "function" && result.reason.getStatus() === 503,
    ),
  );
});
