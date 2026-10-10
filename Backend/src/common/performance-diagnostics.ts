import { Logger } from "@nestjs/common";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { RedisProvider } from "../infrastructure/infrastructure.tokens";

const nanosecondsToMilliseconds = (value: number) =>
  Number((value / 1_000_000).toFixed(2));

const percentile = (values: number[], ratio: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return Number((sorted[Math.max(0, index)] ?? 0).toFixed(2));
};

/**
 * Opt-in, low-volume runtime diagnostics for controlled performance tests.
 * It reports process event-loop delay/utilization and Redis PING RTT without
 * adding a public metrics endpoint or changing request behavior.
 */
export const startPerformanceDiagnostics = (
  redis: RedisProvider,
  intervalMs = 10_000,
) => {
  const logger = new Logger("PerformanceDiagnostics");
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();

  let redisPingInFlight = false;
  let redisPingErrors = 0;
  let redisPingLatenciesMs: number[] = [];
  let previousEventLoopUtilization = performance.eventLoopUtilization();

  const pingTimer = setInterval(() => {
    if (redisPingInFlight || !redis.isReady) return;

    redisPingInFlight = true;
    const startedAt = performance.now();
    void redis
      .ping()
      .then(() => {
        redisPingLatenciesMs.push(performance.now() - startedAt);
      })
      .catch(() => {
        redisPingErrors += 1;
      })
      .finally(() => {
        redisPingInFlight = false;
      });
  }, 1_000);

  const reportTimer = setInterval(() => {
    const eventLoopUtilization = performance.eventLoopUtilization(
      previousEventLoopUtilization,
    );
    previousEventLoopUtilization = performance.eventLoopUtilization();

    logger.log(
      JSON.stringify({
        type: "runtime-performance-sample",
        timestamp: new Date().toISOString(),
        pid: process.pid,
        eventLoop: {
          utilizationPercent: Number(
            (eventLoopUtilization.utilization * 100).toFixed(2),
          ),
          delayMs: {
            min: nanosecondsToMilliseconds(eventLoopDelay.min),
            mean: nanosecondsToMilliseconds(eventLoopDelay.mean),
            p50: nanosecondsToMilliseconds(eventLoopDelay.percentile(50)),
            p95: nanosecondsToMilliseconds(eventLoopDelay.percentile(95)),
            p99: nanosecondsToMilliseconds(eventLoopDelay.percentile(99)),
            max: nanosecondsToMilliseconds(eventLoopDelay.max),
          },
        },
        redisPingRttMs: {
          samples: redisPingLatenciesMs.length,
          p50: percentile(redisPingLatenciesMs, 0.5),
          p95: percentile(redisPingLatenciesMs, 0.95),
          p99: percentile(redisPingLatenciesMs, 0.99),
          errors: redisPingErrors,
        },
      }),
    );

    eventLoopDelay.reset();
    redisPingLatenciesMs = [];
    redisPingErrors = 0;
  }, intervalMs);

  pingTimer.unref();
  reportTimer.unref();

  return () => {
    clearInterval(pingTimer);
    clearInterval(reportTimer);
    eventLoopDelay.disable();
  };
};
