import assert from "node:assert/strict";
import test from "node:test";
import { startRedisTestServer } from "../helpers/redis-test-server";
import { createNestTestContext } from "../helpers/nest-test-context";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("Redis-backed application behavior", async (suite) => {
  const server = await startRedisTestServer();
  process.env.REDIS_URL = server.url;
  process.env.REDIS_COMMAND_TIMEOUT_MS = "2000";
  process.env.REDIS_CONNECT_TIMEOUT_MS = "2000";
  process.env.RATE_LIMIT_REDIS_TIMEOUT_MS = "2000";

  const { closeRedisConnections, redisClient, pubSubRedis } =
    await import("../../src/utils/redis");
  const { CacheService } = await import("../../src/modules/cache/cache.service");
  const { RateLimitService } = await import("../../src/modules/rate-limit/rate-limit.service");
  const { StudyService } = await import("../../src/modules/study/study.service");
  const redis = redisClient.getInstance();
  const pubSub = pubSubRedis.getInstance();
  const { PUBSUB_REDIS_CLIENT, REDIS_CLIENT } = await import(
    "../../src/config/infrastructure.tokens"
  );
  const { CACHE_SERVICE } = await import("../../src/modules/cache/cache.tokens");
  const { ELASTICSEARCH_SERVICE } = await import(
    "../../src/modules/elasticsearch/elasticsearch.tokens"
  );
  const {
    DECK_SYNC_ENQUEUE,
    STUDY_REPOSITORY,
    USER_PROGRESS_REPOSITORY,
  } = await import("../../src/modules/study/study.tokens");
  const applicationContext = await createNestTestContext([
    { provide: REDIS_CLIENT, useValue: redis },
    { provide: PUBSUB_REDIS_CLIENT, useValue: pubSub },
    { provide: ELASTICSEARCH_SERVICE, useValue: {} },
    { provide: DECK_SYNC_ENQUEUE, useValue: async () => undefined },
    { provide: STUDY_REPOSITORY, useValue: {} },
    { provide: USER_PROGRESS_REPOSITORY, useValue: {} },
    CacheService,
    { provide: CACHE_SERVICE, useExisting: CacheService },
    RateLimitService,
    StudyService,
  ]);
  const cacheService = applicationContext.get(CacheService);
  const rateLimits = applicationContext.get(RateLimitService);
  const studyService = applicationContext.get(StudyService);

  try {
    assert.equal(await redis.ping(), "PONG");

    await suite.test(
      "SET/GET and expiration work on the real server",
      async () => {
        await redis.set("test:ttl", "value", { PX: 150 });
        assert.equal(await redis.get("test:ttl"), "value");
        const ttl = await redis.pTTL("test:ttl");
        assert.ok(ttl > 0 && ttl <= 150);
        await wait(180);
        assert.equal(await redis.get("test:ttl"), null);
      },
    );

    await suite.test(
      "tracker reads observe another Redis increment without L1 delay",
      async () => {
        const key = `test:tracker:${Date.now()}`;
        assert.equal(await cacheService.getTracker(key), "1");
        await redis.incr(key);
        assert.equal(await cacheService.getTracker(key), "2");
        await redis.unlink(key);
      },
    );

    await suite.test(
      "GETDEL allows exactly one concurrent consumer",
      async () => {
        await redis.set("test:refresh-token", "token-payload");
        const results = await Promise.all(
          Array.from({ length: 100 }, () => redis.getDel("test:refresh-token")),
        );

        assert.equal(
          results.filter((value) => value === "token-payload").length,
          1,
        );
        assert.equal(results.filter((value) => value === null).length, 99);
      },
    );

    await suite.test(
      "cache single-flight performs one fetch and tag invalidation removes it",
      async () => {
        const key = `test:cache:${Date.now()}`;
        const tags = ["test", "redis-integration"];
        let fetches = 0;
        const fetchValue = async () => {
          fetches += 1;
          await wait(20);
          return { value: "from-source" };
        };

        const results = await Promise.all(
          Array.from({ length: 200 }, () =>
            cacheService.getOrSetWithTag(key, fetchValue, tags, 30),
          ),
        );

        assert.equal(fetches, 1);
        assert.ok(results.every((result) => result.value === "from-source"));
        assert.notEqual(await redis.get(key), null);

        await cacheService.invalidateTag(tags);
        assert.equal(await redis.get(key), null);

        await cacheService.getOrSetWithTag(key, fetchValue, tags, 30);
        assert.equal(fetches, 2);
      },
    );

    await suite.test(
      "monotonic Redis fencing rejects a fill after remote key invalidation",
      async () => {
        const key = `test:cache-fenced:${Date.now()}`;
        const lockKey = `cache:fill-lock:${key}`;
        let beginFetch: (() => void) | undefined;
        let finishFetch: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => {
          beginFetch = resolve;
        });
        const fetchGate = new Promise<void>((resolve) => {
          finishFetch = resolve;
        });

        const oldFill = cacheService.getOrSet(key, async () => {
          beginFetch?.();
          await fetchGate;
          return "stale-source-value";
        });

        try {
          await fetchStarted;
          const oldGeneration = await redis.get(lockKey);
          assert.match(oldGeneration ?? "", /^[1-9]\d*$/);

          // Simulate another instance's atomic delete without delivering its
          // Pub/Sub event to this process's local in-flight map.
          await redis.unlink(lockKey);
          finishFetch?.();

          assert.equal(await oldFill, "stale-source-value");
          assert.equal(await redis.get(key), null);

          await cacheService.getOrSet(key, async () => "fresh-source-value");
          const newGeneration = await redis.get("cache:fill-generation:v1");
          assert.ok(Number(newGeneration) > Number(oldGeneration));
          assert.equal(await redis.get(key), JSON.stringify("fresh-source-value"));
        } finally {
          finishFetch?.();
        }
      },
    );

    await suite.test(
      "tag invalidation revokes registered in-flight generations in Redis",
      async () => {
        const key = `test:cache-tag-fenced:${Date.now()}`;
        const tag = `tag-fenced-${Date.now()}`;
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

        const oldFill = cacheService.getOrSetWithTag(
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
          const generation = await redis.get(lockKey);
          assert.match(generation ?? "", /^[1-9]\d*$/);
          assert.equal(await redis.hGet(activeFillKey, key), generation);

          await cacheService.invalidateTag([tag]);
          assert.equal(await redis.get(lockKey), null);
          assert.equal(await redis.hGet(activeFillKey, key), null);
          finishFetch?.();

          assert.equal(await oldFill, "stale-tagged-value");
          assert.equal(await redis.get(key), null);
        } finally {
          finishFetch?.();
        }
      },
    );

    await suite.test(
      "write-through advances the Redis fence and wins over an older active fill",
      async () => {
        const key = `test:cache-write-through-fenced:${Date.now()}`;
        const tag = `write-through-fenced-${Date.now()}`;
        let beginFetch: (() => void) | undefined;
        let finishFetch: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => {
          beginFetch = resolve;
        });
        const fetchGate = new Promise<void>((resolve) => {
          finishFetch = resolve;
        });

        const oldFill = cacheService.getOrSetWithTag(
          key,
          async () => {
            beginFetch?.();
            await fetchGate;
            return "old-source-value";
          },
          [tag],
        );

        try {
          await fetchStarted;
          const oldGeneration = Number(
            await redis.get("cache:fill-generation:v1"),
          );
          await cacheService.writeThrough(
            key,
            async () => "new-database-value",
            30,
            [tag],
          );
          finishFetch?.();

          assert.equal(await oldFill, "old-source-value");
          assert.equal(await redis.get(key), JSON.stringify("new-database-value"));
          assert.ok(
            Number(await redis.get("cache:fill-generation:v1")) > oldGeneration,
          );
          assert.notEqual(
            await redis.zScore(`cache:tag-set:v2:tag:${tag}`, key),
            null,
          );
        } finally {
          finishFetch?.();
          await cacheService.delete(key);
        }
      },
    );

    await suite.test(
      "tagged cache deletion and expiry prune reverse tag indexes",
      async () => {
        const prefixKey = `test:cache-tag-prefix:${Date.now()}`;
        await cacheService.getOrSetWithTag(
          prefixKey,
          async () => "not-prefix-invalidated",
          ["exact-user2"],
          30,
        );
        await cacheService.invalidateTag(["exact-user"]);
        assert.notEqual(await redis.get(prefixKey), null);
        await cacheService.invalidateTag(["exact-user2"]);
        assert.equal(await redis.get(prefixKey), null);

        const deleteKey = `test:cache-tag-delete:${Date.now()}`;
        const deleteTags = ["integration-delete-a", "integration-delete-b"];
        await cacheService.getOrSetWithTag(
          deleteKey,
          async () => ({ value: "tagged" }),
          deleteTags,
          30,
        );

        const tagA = `cache:tag-set:v2:tag:${deleteTags[0]}`;
        const tagB = `cache:tag-set:v2:tag:${deleteTags[1]}`;
        assert.notEqual(await redis.zScore(tagA, deleteKey), null);
        assert.notEqual(await redis.zScore(tagB, deleteKey), null);
        await cacheService.delete(deleteKey);
        assert.equal(await redis.zScore(tagA, deleteKey), null);
        assert.equal(await redis.zScore(tagB, deleteKey), null);

        const invalidateKey = `test:cache-tag-invalidate:${Date.now()}`;
        const invalidateTags = ["integration-invalidate-a", "integration-invalidate-b"];
        await cacheService.getOrSetWithTag(
          invalidateKey,
          async () => ({ value: "tagged" }),
          invalidateTags,
          30,
        );
        const remainingTag = `cache:tag-set:v2:tag:${invalidateTags[1]}`;
        await cacheService.invalidateTag([invalidateTags[0]!]);
        assert.equal(await redis.get(invalidateKey), null);
        assert.equal(await redis.zScore(remainingTag, invalidateKey), null);

        const expiringKey = `test:cache-tag-expiring:${Date.now()}`;
        const anchorKey = `test:cache-tag-anchor:${Date.now()}`;
        const freshKey = `test:cache-tag-fresh:${Date.now()}`;
        const sharedTag = "integration-expiry-prune";
        const sharedTagKey = `cache:tag-set:v2:tag:${sharedTag}`;
        await cacheService.getOrSetWithTag(
          expiringKey,
          async () => "expires-first",
          [sharedTag],
          1,
        );
        await cacheService.getOrSetWithTag(
          anchorKey,
          async () => "keeps-tag-set-alive",
          [sharedTag],
          30,
        );
        // Tag scores carry a one-second safety grace beyond Redis key expiry.
        await wait(2_100);
        await cacheService.getOrSetWithTag(
          freshKey,
          async () => "fresh",
          [sharedTag],
          30,
        );

        assert.equal(await redis.get(expiringKey), null);
        assert.equal(await redis.zScore(sharedTagKey, expiringKey), null);
        assert.notEqual(await redis.zScore(sharedTagKey, anchorKey), null);
        assert.notEqual(await redis.zScore(sharedTagKey, freshKey), null);
      },
    );

    await suite.test(
      "study-session Lua updates remain atomic across concurrent submissions",
      async () => {
        const userId = "64b000000000000000000011";
        const setId = "64b000000000000000000012";
        const sessionId = `lua-session-${Date.now()}`;
        const answers = Array.from({ length: 300 }, (_, index) => ({
          cardId: `64b000000000000000000${String(100 + (index % 10)).slice(-3)}`,
          isCorrect: index % 3 !== 0,
        }));

        await Promise.all(
          answers.map(({ cardId, isCorrect }) =>
            studyService.submitAnswer({
              userId,
              sessionId,
              setId,
              mode: "QUIZ",
              cardId,
              isCorrect,
            }),
          ),
        );

        const raw = await redis.get(`user:${userId}:session:${sessionId}`);
        assert.ok(raw);
        const state = JSON.parse(raw) as {
          correctCount: number;
          wrongCount: number;
          totalCards: number;
          cardProgressMap: Record<
            string,
            { correctCount: number; wrongCount: number }
          >;
        };
        assert.equal(state.correctCount, 200);
        assert.equal(state.wrongCount, 100);
        assert.equal(state.totalCards, 10);
        assert.equal(Object.keys(state.cardProgressMap).length, 10);
        assert.equal(
          Object.values(state.cardProgressMap).reduce(
            (total, progress) => total + progress.correctCount,
            0,
          ),
          200,
        );
        assert.equal(
          Object.values(state.cardProgressMap).reduce(
            (total, progress) => total + progress.wrongCount,
            0,
          ),
          100,
        );
      },
    );

    await suite.test(
      "Lua token bucket remains atomic under concurrent requests",
      async () => {
        const capacity = 50;
        const policy = {
          namespace: `integration-${Date.now()}`,
          bucketCapacity: capacity,
          refillPerMs: 0.000000001,
          idleTtlMs: 60_000,
        };
        const results = await Promise.all(
          Array.from({ length: 500 }, () =>
            rateLimits.consumeToken("same-client", policy),
          ),
        );

        assert.equal(
          results.filter((result) => result.allowed).length,
          capacity,
        );
        assert.equal(
          results.filter((result) => !result.allowed).length,
          results.length - capacity,
        );
        assert.ok(
          results
            .filter((result) => !result.allowed)
            .every((result) => result.retryAfterMs > 0),
        );
      },
    );

    await suite.test(
      "rate limiter reloads its Lua script after SCRIPT FLUSH",
      async () => {
        await redis.scriptFlush();
        const result = await rateLimits.consumeToken("after-script-flush", {
          namespace: `noscript-${Date.now()}`,
          bucketCapacity: 2,
          refillPerMs: 0.001,
          idleTtlMs: 60_000,
        });
        assert.equal(result.allowed, true);
      },
    );

    await suite.test(
      "rate-limit and blacklist checks share one Redis pipeline",
      async () => {
        const jti = `pipeline-jti-${Date.now()}`;
        await redis.set(`blacklist_token:${jti}`, "revoked", { EX: 60 });
        // Force the pipeline down the NOSCRIPT recovery path as well. The
        // blacklist EXISTS remains safe to repeat while EVALSHA did not run.
        await redis.scriptFlush();

        const result = await rateLimits.consumeToken(
          "pipeline-client",
          {
            namespace: `pipeline-${Date.now()}`,
            bucketCapacity: 2,
            refillPerMs: 0.001,
            idleTtlMs: 60_000,
          },
          jti,
        );

        assert.equal(result.allowed, true);
        assert.equal(result.revoked, true);
      },
    );
  } finally {
    await applicationContext.close();
    await closeRedisConnections();
    await server.stop();
    delete process.env.REDIS_URL;
  }
});
