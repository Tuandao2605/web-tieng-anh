import { redisClient } from "../utils/redis";
const redis = redisClient.getInstance();

// ─── Single-flight registry ────────────────────────────────────────────────────
// Prevents thundering herd: if a DB fetch is already in-flight for a key, all
// concurrent callers await the SAME Promise instead of each hitting the DB.
const _inFlight = new Map<string, Promise<any>>();

export const cacheService = {
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600,
  ): Promise<T> {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // Coalesce concurrent misses into a single DB call
    if (_inFlight.has(key)) {
      return _inFlight.get(key) as Promise<T>;
    }

    const promise = fetchFn().then(async (freshData) => {
      _inFlight.delete(key);
      if (freshData !== null && freshData !== undefined) {
        await redis.set(key, JSON.stringify(freshData), { EX: ttl });
      }
      return freshData;
    }).catch((err) => {
      _inFlight.delete(key);
      throw err;
    });

    _inFlight.set(key, promise);
    return promise;
  },

  // FIX #3: Use UNLINK instead of DEL.
  // DEL reclaims memory synchronously, blocking Redis's main thread for large keys.
  // UNLINK marks the key as deleted immediately, then reclaims memory in a background thread.
  async delete(key: string) {
    return redis.unlink(key);
  },

  // FIX #2: Stream-delete in batches of 500 to avoid unbounded RAM growth.
  // If the pattern matches millions of keys, collecting them all into one array
  // would exhaust Node.js heap. Flushing every 500 keys caps memory at O(batch_size)
  // while still reducing round-trips vs the old sequential per-key delete.
  async deletePattern(pattern: string) {
    let batch: string[] = [];
    for await (const key of redis.scanIterator({ TYPE: "string", MATCH: pattern })) {
      batch.push(key as unknown as string);
      if (batch.length >= 500) {
        await redis.unlink(batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await redis.unlink(batch);
    }
  },

  // FIX #4: Atomic initialization with SET NX to eliminate the race condition.
  // Previously: GET → check → SET was non-atomic: two concurrent callers could both
  // see !version and both write "1". Now SET NX is a single atomic Redis operation.
  async getTracker(key: string) {
    // SET NX returns null if key already exists, "OK" if it was created.
    await redis.set(key, "1", { NX: true });
    // Always GET after to return the authoritative current value.
    const version = await redis.get(key);
    return version ?? "1";
  },

  async invalidateGetTracker(key: string) {
    const newVersion = await redis.incr(key);
    return newVersion;
  },

  async getOrSetWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
  ): Promise<T> {
    // Check Redis cache first
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // Coalesce concurrent cache misses — only ONE DB call fires per key
    if (_inFlight.has(key)) {
      return _inFlight.get(key) as Promise<T>;
    }

    const promise = fetchFn().then(async (freshData) => {
      _inFlight.delete(key);
      if (freshData !== null && freshData !== undefined) {
        const multi = redis.multi();
        multi.set(key, JSON.stringify(freshData), { EX: ttl });
        const tagName = `tag:${tags.join(":")}`;
        multi.sAdd(tagName, key);
        multi.expire(tagName, ttl);
        await multi.exec();
      }
      return freshData;
    }).catch((err) => {
      _inFlight.delete(key);
      throw err;
    });

    _inFlight.set(key, promise);
    return promise;
  },

  async getOrSetRawWithTag(
    key: string,
    fetchFn: () => Promise<any>,
    tags: string[],
    ttl: number = 3600,
    formatWrapper?: (data: any) => any,
  ): Promise<string> {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return cachedData;
    }

    if (_inFlight.has(key)) {
      return _inFlight.get(key) as Promise<string>;
    }

    const promise = fetchFn()
      .then(async (freshData) => {
        _inFlight.delete(key);
        if (freshData !== null && freshData !== undefined) {
          const payload = formatWrapper ? formatWrapper(freshData) : freshData;
          const rawJson = typeof payload === "string" ? payload : JSON.stringify(payload);
          const multi = redis.multi();
          multi.set(key, rawJson, { EX: ttl });
          const tagName = `tag:${tags.join(":")}`;
          multi.sAdd(tagName, key);
          multi.expire(tagName, ttl);
          await multi.exec();
          return rawJson;
        }
        return "";
      })
      .catch((err) => {
        _inFlight.delete(key);
        throw err;
      });

    _inFlight.set(key, promise);
    return promise;
  },

  async invalidateTag(tags: string[]) {
    const prefix = `tag:${tags.join(":")}`;
    const allKeysToDelete = new Set<string>();

    // Collect all matching tag keys via SCAN
    let cursor = "0";
    do {
      const reply = await redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
      cursor = reply.cursor;
      const foundTags = reply.keys;

      if (foundTags.length > 0) {
        // FIX #1: Fire all sMembers calls in PARALLEL instead of awaiting each sequentially.
        // Previously O(N) sequential round-trips; now O(1) latency regardless of tag count.
        const memberResults = await Promise.all(
          foundTags.map((tagName) => redis.sMembers(tagName)),
        );
        foundTags.forEach((tagName, i) => {
          memberResults[i]!.forEach((memberKey) => allKeysToDelete.add(memberKey));
          allKeysToDelete.add(tagName);
        });
      }
    } while (cursor !== "0");

    if (allKeysToDelete.size > 0) {
      // UNLINK: non-blocking async delete (background thread)
      await redis.unlink(Array.from(allKeysToDelete));
    }
  },

  async writeThrough<T>(
    key: string,
    dbAction: () => Promise<T>,
    ttl: number = 3600,
  ) {
    //goi ham dbAction
    const result = await dbAction();
    await redis.set(key, JSON.stringify(result), {
      EX: ttl,
    });
    return result;
  },
};
