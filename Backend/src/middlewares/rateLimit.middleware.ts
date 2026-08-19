import { NextFunction, Request, Response } from "express";
import { redisClient } from "../utils/redis";
import { errorResponse } from "../utils/response";
const redis = redisClient.getInstance();

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const REQUESTS_PER_WINDOW = positiveNumberFromEnv(
  process.env.RATE_LIMIT_MAX_REQUESTS,
  100000,
);
const WINDOW_MS = positiveNumberFromEnv(
  process.env.RATE_LIMIT_WINDOW_MS,
  60000,
);
const DEFAULT_REFILL_PER_SECOND = REQUESTS_PER_WINDOW / (WINDOW_MS / 1000);
const REFILL_PER_SECOND = positiveNumberFromEnv(
  process.env.RATE_LIMIT_REFILL_PER_SECOND,
  DEFAULT_REFILL_PER_SECOND,
);
const BUCKET_CAPACITY = positiveNumberFromEnv(
  process.env.RATE_LIMIT_BUCKET_CAPACITY,
  REQUESTS_PER_WINDOW,
);
const REFILL_PER_MS = REFILL_PER_SECOND / 1000;
const BUCKET_IDLE_TTL_MS = Math.ceil(
  Math.max(WINDOW_MS, (BUCKET_CAPACITY / REFILL_PER_SECOND) * 1000) * 2,
);

// Token bucket executed atomically in Redis. Redis TIME avoids clock skew among
// multiple Node.js instances while the hash stores only two fields per client.
const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local idle_ttl_ms = tonumber(ARGV[4])

local redis_time = redis.call("TIME")
local now_ms = redis_time[1] * 1000 + math.floor(redis_time[2] / 1000)
local bucket = redis.call("HMGET", KEYS[1], "tokens", "last_refill_ms")
local tokens = tonumber(bucket[1])
local last_refill_ms = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill_ms = now_ms
end

local elapsed_ms = math.max(0, now_ms - last_refill_ms)
tokens = math.min(capacity, tokens + elapsed_ms * refill_per_ms)

local allowed = 0
local retry_after_ms = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  retry_after_ms = math.ceil((requested - tokens) / refill_per_ms)
end

redis.call("HSET", KEYS[1], "tokens", tokens, "last_refill_ms", now_ms)
redis.call("PEXPIRE", KEYS[1], idle_ttl_ms)
return { allowed, math.floor(tokens), retry_after_ms }
`;

export const consumeRateLimitToken = async (identity: string) => {
  const key = `rateLimit:bucket:${identity}`;
  const result = await redis.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [key],
    arguments: [
      String(BUCKET_CAPACITY),
      String(REFILL_PER_MS),
      "1",
      String(BUCKET_IDLE_TTL_MS),
    ],
  }) as [number, number, number];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
  };
};

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const identity = req.ip ?? req.socket.remoteAddress ?? "unknown-client";
  const result = await consumeRateLimitToken(identity);

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    res.setHeader("Retry-After", retryAfterSeconds);
    return errorResponse(
      res,
      "Too many requests, please try again later",
      {
        code: "MANY_REQUESTS",
        time_left_seconds: retryAfterSeconds,
      },
      429,
    );
  }

  next();
};
