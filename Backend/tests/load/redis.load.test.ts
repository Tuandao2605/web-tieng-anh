import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { startRedisTestServer } from "../helpers/redis-test-server";

const positiveIntegerFromEnv = (
  value: string | undefined,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const percentile = (sortedValues: number[], percentage: number) => {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * percentage) - 1,
  );
  return sortedValues[Math.max(0, index)] ?? 0;
};

const runLoad = async (
  total: number,
  concurrency: number,
  operation: (index: number) => Promise<void>,
) => {
  const latencies: number[] = [];
  let nextIndex = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;

        const operationStartedAt = performance.now();
        await operation(index);
        latencies.push(performance.now() - operationStartedAt);
      }
    }),
  );

  const durationMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    total,
    concurrency,
    durationMs,
    operationsPerSecond: total / (durationMs / 1_000),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
  };
};

test("Redis load profile", async (suite) => {
  const total = positiveIntegerFromEnv(
    process.env.REDIS_LOAD_OPERATIONS,
    10_000,
  );
  const concurrency = positiveIntegerFromEnv(
    process.env.REDIS_LOAD_CONCURRENCY,
    100,
  );
  const minimumOperationsPerSecond = positiveIntegerFromEnv(
    process.env.REDIS_LOAD_MIN_OPS_PER_SECOND,
    500,
  );
  const maximumP99Ms = positiveIntegerFromEnv(
    process.env.REDIS_LOAD_MAX_P99_MS,
    250,
  );
  const server = await startRedisTestServer();
  process.env.REDIS_URL = server.url;
  process.env.REDIS_COMMAND_TIMEOUT_MS = "5000";
  process.env.RATE_LIMIT_REDIS_TIMEOUT_MS = "5000";

  const { closeRedisConnections, redisClient } =
    await import("../../src/utils/redis");
  const { consumeRateLimitToken } =
    await import("../../src/middlewares/rateLimit.middleware");
  const redis = redisClient.getInstance();

  try {
    assert.equal(await redis.ping(), "PONG");

    await suite.test("parallel SET/GET workload", async (t) => {
      const metrics = await runLoad(total, concurrency, async (index) => {
        const key = `load:value:${index}`;
        await redis.set(key, String(index), { EX: 60 });
        const value = await redis.get(key);
        assert.equal(value, String(index));
      });
      t.diagnostic(JSON.stringify({ workload: "SET+GET", ...metrics }));
      assert.ok(metrics.operationsPerSecond >= minimumOperationsPerSecond);
      assert.ok(metrics.p99Ms <= maximumP99Ms);
    });

    await suite.test("parallel Lua token-bucket workload", async (t) => {
      const metrics = await runLoad(total, concurrency, async () => {
        const result = await consumeRateLimitToken("load-client", {
          namespace: `load-${process.pid}`,
          bucketCapacity: total + 1,
          refillPerMs: 0.001,
          idleTtlMs: 60_000,
        });
        assert.equal(result.allowed, true);
      });
      t.diagnostic(JSON.stringify({ workload: "TOKEN_BUCKET", ...metrics }));
      assert.ok(metrics.operationsPerSecond >= minimumOperationsPerSecond);
      assert.ok(metrics.p99Ms <= maximumP99Ms);
    });
  } finally {
    await closeRedisConnections();
    await server.stop();
    delete process.env.REDIS_URL;
  }
});
