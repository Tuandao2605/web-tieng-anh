import { NextFunction, Request, Response } from "express";
import type { JwtPayload } from "jsonwebtoken";
import { JwtPayLoad } from "../types/auth";
import { verifyToken } from "../utils/jwt";
import { redisClient } from "../utils/redis";
import { errorResponse } from "../utils/response";
const redis = redisClient.getInstance();

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const REQUESTS_PER_WINDOW = positiveNumberFromEnv(
  process.env.RATE_LIMIT_MAX_REQUESTS,
  100,
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
const REDIS_COMMAND_TIMEOUT_MS = positiveNumberFromEnv(
  process.env.RATE_LIMIT_REDIS_TIMEOUT_MS,
  1000,
);
const IDENTITY_CACHE_TTL_MS = positiveNumberFromEnv(
  process.env.RATE_LIMIT_IDENTITY_CACHE_TTL_MS,
  5000,
);
const IDENTITY_CACHE_MAX_ENTRIES = positiveNumberFromEnv(
  process.env.RATE_LIMIT_IDENTITY_CACHE_MAX_ENTRIES,
  10000,
);
const AUTH_REQUESTS_PER_WINDOW = positiveNumberFromEnv(
  process.env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  5,
);
const AUTH_WINDOW_MS = positiveNumberFromEnv(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS,
  60000,
);
const HEAVY_REQUESTS_PER_WINDOW = positiveNumberFromEnv(
  process.env.HEAVY_RATE_LIMIT_MAX_REQUESTS,
  10,
);
const HEAVY_WINDOW_MS = positiveNumberFromEnv(
  process.env.HEAVY_RATE_LIMIT_WINDOW_MS,
  60000,
);
const FAILURE_LOG_INTERVAL_MS = 30000;
let lastFailureLogAt = 0;

type IdentityCacheEntry = {
  userId: string;
  expiresAt: number;
};

// This positive-only L1 caches verified token -> user ID mappings. Invalid
// tokens are attacker-controlled and must never consume cache capacity, or they
// could evict valid identities and force repeated signature verification.
// It never caches an "allowed" decision or token count, so Redis remains the
// atomic global quota authority when the application runs in multiple workers.
const identityCache = new Map<string, IdentityCacheEntry>();

const readCachedIdentity = (token: string) => {
  const entry = identityCache.get(token);
  if (!entry) return { hit: false as const };
  if (entry.expiresAt <= Date.now()) {
    identityCache.delete(token);
    return { hit: false as const };
  }

  identityCache.delete(token);
  identityCache.set(token, entry);
  return { hit: true as const, userId: entry.userId };
};

const cacheIdentity = (
  token: string,
  userId: string,
  tokenExpiresAt?: number,
) => {
  if (identityCache.has(token)) identityCache.delete(token);
  while (identityCache.size >= IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestToken = identityCache.keys().next().value as string | undefined;
    if (!oldestToken) break;
    identityCache.delete(oldestToken);
  }

  identityCache.set(token, {
    userId,
    expiresAt: Math.min(
      Date.now() + IDENTITY_CACHE_TTL_MS,
      tokenExpiresAt ?? Number.POSITIVE_INFINITY,
    ),
  });
};

const logRateLimiterFailure = (message: string, error?: unknown) => {
  const now = Date.now();
  if (now - lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;

  lastFailureLogAt = now;
  // eslint-disable-next-line no-console
  console.error(message, error ?? "");
};

const getUserIdFromAccessToken = (authorization: string | undefined) => {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1];
  if (!token) return undefined;

  const cachedIdentity = readCachedIdentity(token);
  if (cachedIdentity.hit) return cachedIdentity.userId;

  try {
    const decoded = verifyToken(token);
    if (!decoded || typeof decoded === "string") return undefined;

    const userId = (decoded as Partial<JwtPayLoad>).id;
    const normalizedUserId =
      typeof userId === "string" && userId.length > 0 ? userId : undefined;
    if (!normalizedUserId) return undefined;

    const tokenExpiry = (decoded as JwtPayload).exp;
    const expiresAt =
      typeof tokenExpiry === "number" ? tokenExpiry * 1000 : undefined;
    cacheIdentity(token, normalizedUserId, expiresAt);
    return normalizedUserId;
  } catch {
    // Identity lookup must never turn a malformed token into a server error.
    return undefined;
  }
};

type IdentityStrategy = "ip" | "user-or-ip";
type FailureMode = "open" | "closed";

type RateLimitOptions = {
  namespace: string;
  maxRequests: number;
  windowMs: number;
  bucketCapacity?: number;
  refillPerSecond?: number;
  identityStrategy?: IdentityStrategy;
  failureMode?: FailureMode;
};

type RateLimitPolicy = {
  namespace: string;
  bucketCapacity: number;
  refillPerMs: number;
  idleTtlMs: number;
};

const getRateLimitIdentity = (req: Request, strategy: IdentityStrategy) => {
  const clientIp = req.ip ?? req.socket.remoteAddress;
  if (strategy === "ip") return clientIp ? `ip:${clientIp}` : undefined;

  // Authentication still happens in authMiddleware. Signature verification here
  // only prevents clients from forging user IDs to rotate rate-limit buckets.
  const userId =
    req.user?.id ?? getUserIdFromAccessToken(req.headers.authorization);
  if (userId) return `user:${userId}`;

  return clientIp ? `ip:${clientIp}` : undefined;
};

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

if tokens == nil or last_refill_ms == nil then
  tokens = capacity
  last_refill_ms = now_ms
end

-- Redis TIME is authoritative across all Node instances. Guard against a
-- partially restored/corrupt future timestamp so elapsed time never goes below 0.
last_refill_ms = math.min(last_refill_ms, now_ms)
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

let tokenBucketSha: string | null = null;
let tokenBucketLoadPromise: Promise<string> | null = null;
let tokenBucketGeneration = 0;

const loadTokenBucketScript = () => {
  if (tokenBucketSha) return Promise.resolve(tokenBucketSha);
  if (!tokenBucketLoadPromise) {
    tokenBucketLoadPromise = redis
      .scriptLoad(TOKEN_BUCKET_SCRIPT)
      .then((sha) => {
        tokenBucketSha = sha.toString();
        return tokenBucketSha;
      })
      .finally(() => {
        tokenBucketLoadPromise = null;
      });
  }
  return tokenBucketLoadPromise;
};

const isNoScriptError = (error: unknown) =>
  error instanceof Error && error.message.includes("NOSCRIPT");

const evaluateTokenBucket = async (key: string, arguments_: string[]) => {
  const commandOptions = { keys: [key], arguments: arguments_ };
  let sha = await loadTokenBucketScript();
  const evaluatedGeneration = tokenBucketGeneration;

  try {
    return await redis
      .withCommandOptions({ timeout: REDIS_COMMAND_TIMEOUT_MS })
      .evalSha(sha, commandOptions);
  } catch (error) {
    if (!isNoScriptError(error)) throw error;

    // Redis restart/SCRIPT FLUSH clears its script cache. Reload once and retry;
    // concurrent callers share the same SCRIPT LOAD promise.
    // Only the first caller invalidates the failed SHA. Other concurrent
    // NOSCRIPT callers reuse the reload already in progress.
    if (tokenBucketGeneration === evaluatedGeneration) {
      tokenBucketGeneration += 1;
      tokenBucketSha = null;
    }
    sha = await loadTokenBucketScript();
    return redis
      .withCommandOptions({ timeout: REDIS_COMMAND_TIMEOUT_MS })
      .evalSha(sha, commandOptions);
  }
};

const createPolicy = (options: RateLimitOptions): RateLimitPolicy => {
  const bucketCapacity = options.bucketCapacity ?? options.maxRequests;
  const refillPerSecond =
    options.refillPerSecond ?? options.maxRequests / (options.windowMs / 1000);

  return {
    namespace: options.namespace,
    bucketCapacity,
    refillPerMs: refillPerSecond / 1000,
    idleTtlMs: Math.ceil(
      Math.max(options.windowMs, (bucketCapacity / refillPerSecond) * 1000) * 2,
    ),
  };
};

const GLOBAL_POLICY = createPolicy({
  namespace: "global",
  maxRequests: REQUESTS_PER_WINDOW,
  windowMs: WINDOW_MS,
  bucketCapacity: BUCKET_CAPACITY,
  refillPerSecond: REFILL_PER_SECOND,
});

export const consumeRateLimitToken = async (
  identity: string,
  policy: RateLimitPolicy = GLOBAL_POLICY,
) => {
  const key = `rateLimit:${policy.namespace}:${identity}`;
  const result = (await evaluateTokenBucket(key, [
    String(policy.bucketCapacity),
    String(policy.refillPerMs),
    "1",
    String(policy.idleTtlMs),
  ])) as [number, number, number];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
  };
};

export const createRateLimitMiddleware = (options: RateLimitOptions) => {
  const policy = createPolicy(options);
  const identityStrategy = options.identityStrategy ?? "user-or-ip";
  const failureMode = options.failureMode ?? "open";

  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = getRateLimitIdentity(req, identityStrategy);
    if (!identity) {
      logRateLimiterFailure(
        `Rate limiter '${policy.namespace}' could not determine the client identity`,
      );
      if (failureMode === "open") return next();

      return errorResponse(
        res,
        "Rate limiter temporarily unavailable",
        { code: "RATE_LIMIT_UNAVAILABLE" },
        503,
      );
    }

    try {
      const result = await consumeRateLimitToken(identity, policy);

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(result.retryAfterMs / 1000),
        );
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

      return next();
    } catch (error) {
      logRateLimiterFailure(
        `Rate limiter '${policy.namespace}' Redis error`,
        error,
      );
      if (failureMode === "open") return next();

      return errorResponse(
        res,
        "Rate limiter temporarily unavailable",
        { code: "RATE_LIMIT_UNAVAILABLE" },
        503,
      );
    }
  };
};

export const rateLimitMiddleware = createRateLimitMiddleware({
  namespace: "global",
  maxRequests: REQUESTS_PER_WINDOW,
  windowMs: WINDOW_MS,
  bucketCapacity: BUCKET_CAPACITY,
  refillPerSecond: REFILL_PER_SECOND,
});

export const sensitiveAuthRateLimitMiddleware = createRateLimitMiddleware({
  namespace: "auth-sensitive",
  maxRequests: AUTH_REQUESTS_PER_WINDOW,
  windowMs: AUTH_WINDOW_MS,
  identityStrategy: "ip",
  failureMode: "closed",
});

export const heavyRateLimitMiddleware = createRateLimitMiddleware({
  namespace: "heavy",
  maxRequests: HEAVY_REQUESTS_PER_WINDOW,
  windowMs: HEAVY_WINDOW_MS,
});
