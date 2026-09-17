import assert from "node:assert/strict";
import test from "node:test";
import { startRedisTestServer } from "../helpers/redis-test-server";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("Redis-backed application behavior", async (suite) => {
  const server = await startRedisTestServer();
  process.env.REDIS_URL = server.url;
  process.env.REDIS_COMMAND_TIMEOUT_MS = "2000";
  process.env.REDIS_CONNECT_TIMEOUT_MS = "2000";
  process.env.RATE_LIMIT_REDIS_TIMEOUT_MS = "2000";

  const { closeRedisConnections, redisClient } =
    await import("../../src/utils/redis");
  const { cacheService } = await import("../../src/services/cache.service");
  const { consumeRateLimitToken } =
    await import("../../src/middlewares/rateLimit.middleware");
  const redis = redisClient.getInstance();

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
            consumeRateLimitToken("same-client", policy),
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
        const result = await consumeRateLimitToken("after-script-flush", {
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

        const result = await consumeRateLimitToken(
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
    await closeRedisConnections();
    await server.stop();
    delete process.env.REDIS_URL;
  }
});
