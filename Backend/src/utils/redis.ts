import { createClient, RedisClientType } from "redis";
type RedisClient = {
  client: RedisClientType | null;
  instance: RedisClient | null;
  getInstance: () => RedisClientType;
};
export const redisClient: RedisClient = {
  client: null,
  instance: null,
  getInstance() {
    const url = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
    if (!this.client) {
      this.client = createClient({
        url,
      });
      this.client.on("error", (error) => {
        console.log(`Redis Client Error`, error);
      });
      this.client.connect().then(() => {
        console.log(`Redis Connected`);
      });
    }

    return this.client;
  },
};

type RedisPubSubClient = {
  pubClient: RedisClientType | null;
  subClient: RedisClientType | null;
  getInstance: () => RedisPubSubClient;
};

export const pubSubRedis: RedisPubSubClient = {
  pubClient: null,
  subClient: null,
  getInstance() {
    const url = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
    if (!this.pubClient) {
      this.pubClient = createClient({ url });

      this.pubClient.on("error", (error) =>
        console.log("Pub Redis Client Error", error),
      );

      this.pubClient.connect().then(() => {
        console.log("Pub Redis connected");
      });
    }

    if (!this.subClient) {
      this.subClient = createClient({ url });

      this.subClient.on("error", (error) =>
        console.log("Sub Redis Client Error", error),
      );

      this.subClient.connect().then(() => {
        console.log("Sub Redis connected");
      });
    }

    return this;
  },
};
