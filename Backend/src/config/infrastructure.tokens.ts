import type { prisma } from "../libs/prisma";
import type { pubSubRedis, redisClient } from "../utils/redis";

/** DI tokens for infrastructure singletons shared by Nest modules. */
export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const PUBSUB_REDIS_CLIENT = Symbol("PUBSUB_REDIS_CLIENT");

export type PrismaProvider = typeof prisma;
export type RedisProvider = ReturnType<typeof redisClient.getInstance>;
export type PubSubRedisProvider = ReturnType<typeof pubSubRedis.getInstance>;
