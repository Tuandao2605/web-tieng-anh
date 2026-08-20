import { createClient } from "redis";

type AppRedisClient = ReturnType<typeof createClient>;

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const REDIS_COMMAND_TIMEOUT_MS = positiveNumberFromEnv(
  process.env.REDIS_COMMAND_TIMEOUT_MS,
  3000,
);
const REDIS_CONNECT_TIMEOUT_MS = positiveNumberFromEnv(
  process.env.REDIS_CONNECT_TIMEOUT_MS,
  5000,
);
const REDIS_MAX_RECONNECT_DELAY_MS = 3000;
const REDIS_ERROR_LOG_INTERVAL_MS = 30000;
const lastErrorLogByClient = new Map<string, number>();

const getRedisUrl = () =>
  process.env.REDIS_URL ??
  `redis://${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? "6379"}`;

const logRedisError = (name: string, error: unknown) => {
  const now = Date.now();
  const lastLoggedAt = lastErrorLogByClient.get(name) ?? 0;
  if (now - lastLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) return;

  lastErrorLogByClient.set(name, now);
  // eslint-disable-next-line no-console
  console.error(`${name} Redis error`, error);
};

const createRedisConnection = (name: string): AppRedisClient => {
  const client = createClient({
    url: getRedisUrl(),
    commandOptions: { timeout: REDIS_COMMAND_TIMEOUT_MS },
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        Math.min(100 * 2 ** Math.min(retries, 5), REDIS_MAX_RECONNECT_DELAY_MS),
    },
  });

  client.on("error", (error) => logRedisError(name, error));
  void client
    .connect()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`${name} Redis connected`);
    })
    .catch((error: unknown) => logRedisError(name, error));

  return client;
};

type RedisClient = {
  client: AppRedisClient | null;
  getInstance: () => AppRedisClient;
};

export const redisClient: RedisClient = {
  client: null,
  getInstance() {
    if (!this.client) {
      this.client = createRedisConnection("Main");
    }
    return this.client;
  },
};

type RedisPubSubClient = {
  pubClient: AppRedisClient | null;
  subClient: AppRedisClient | null;
  getInstance: () => RedisPubSubClient;
};

export const pubSubRedis: RedisPubSubClient = {
  pubClient: null,
  subClient: null,
  getInstance() {
    if (!this.pubClient) {
      this.pubClient = createRedisConnection("Publisher");
    }
    if (!this.subClient) {
      this.subClient = createRedisConnection("Subscriber");
    }
    return this;
  },
};

export const closeRedisConnections = async () => {
  const clients = [
    redisClient.client,
    pubSubRedis.pubClient,
    pubSubRedis.subClient,
  ].filter((client): client is AppRedisClient => client !== null);

  await Promise.all(
    clients.map(async (client) => {
      if (client.isOpen) await client.close();
    }),
  );
};
