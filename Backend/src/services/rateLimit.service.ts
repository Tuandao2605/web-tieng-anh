import { redisClient } from "../utils/redis";
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
type RateLimitOptions = {
  namespace: string;
  maxRequests: number;
  windowMs: number;
  bucketCapacity?: number;
  refillPerSecond?: number;
};

type RateLimitPolicy = {
  namespace: string;
  bucketCapacity: number;
  refillPerMs: number;
  idleTtlMs: number;
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

const executeTokenBucketPipeline = async (
  sha: string,
  key: string,
  arguments_: string[],
  blacklistJti?: string,
) => {
  const commandOptions = { keys: [key], arguments: arguments_ };
  const client = redis.withCommandOptions({
    timeout: REDIS_COMMAND_TIMEOUT_MS,
  });

  if (!blacklistJti) {
    return {
      bucket: (await client.evalSha(sha, commandOptions)) as [
        number,
        number,
        number,
      ],
      revoked: false,
    };
  }

  // execAsPipeline sends EVALSHA and EXISTS in one network batch without the
  // MULTI/EXEC transaction overhead. Redis still executes the Lua token bucket
  // atomically, and the centralized blacklist remains strongly consistent.
  const replies = await client
    .multi()
    .evalSha(sha, commandOptions)
    .exists(`blacklist_token:${blacklistJti}`)
    .execAsPipeline();
  const bucketReply = replies[0];
  const blacklistReply = replies[1];
  if (bucketReply instanceof Error) throw bucketReply;
  if (blacklistReply instanceof Error) throw blacklistReply;

  return {
    bucket: bucketReply as unknown as [number, number, number],
    revoked: Number(blacklistReply) > 0,
  };
};

const evaluateTokenBucket = async (
  key: string,
  arguments_: string[],
  blacklistJti?: string,
) => {
  let sha = await loadTokenBucketScript();
  const evaluatedGeneration = tokenBucketGeneration;

  try {
    return await executeTokenBucketPipeline(
      sha,
      key,
      arguments_,
      blacklistJti,
    );
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
    return executeTokenBucketPipeline(sha, key, arguments_, blacklistJti);
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
  blacklistJti?: string,
) => {
  const key = `rateLimit:${policy.namespace}:${identity}`;
  const evaluation = await evaluateTokenBucket(
    key,
    [
      String(policy.bucketCapacity),
      String(policy.refillPerMs),
      "1",
      String(policy.idleTtlMs),
    ],
    blacklistJti,
  );
  const result = evaluation.bucket;

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
    revoked: evaluation.revoked,
  };
};

const SENSITIVE_AUTH_POLICY = createPolicy({
  namespace: "auth-sensitive",
  maxRequests: AUTH_REQUESTS_PER_WINDOW,
  windowMs: AUTH_WINDOW_MS,
});

export const consumeSensitiveAuthRateLimitToken = (identity: string) =>
  consumeRateLimitToken(identity, SENSITIVE_AUTH_POLICY);

const HEAVY_POLICY = createPolicy({
  namespace: "heavy",
  maxRequests: HEAVY_REQUESTS_PER_WINDOW,
  windowMs: HEAVY_WINDOW_MS,
});

export const consumeHeavyRateLimitToken = (identity: string) =>
  consumeRateLimitToken(identity, HEAVY_POLICY);
