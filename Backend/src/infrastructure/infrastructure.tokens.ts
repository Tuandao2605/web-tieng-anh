import type { cacheService } from "../services/cache.service";
import type { prisma } from "../libs/prisma";
import type { redisClient } from "../utils/redis";

/** DI tokens for infrastructure singletons shared by Nest modules. */
export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const CACHE_SERVICE = Symbol("CACHE_SERVICE");

export type PrismaProvider = typeof prisma;
export type RedisProvider = ReturnType<typeof redisClient.getInstance>;
export type CacheProvider = typeof cacheService;
