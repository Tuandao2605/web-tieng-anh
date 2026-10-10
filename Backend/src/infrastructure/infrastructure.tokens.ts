import type { Client } from "@elastic/elasticsearch";
import type { CacheService } from "../services/cache.service";
import type { ElasticsearchService } from "../services/elasticsearch.service";
import type { prisma } from "../libs/prisma";
import type { pubSubRedis, redisClient } from "../utils/redis";

/** DI tokens for infrastructure singletons shared by Nest modules. */
export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const PUBSUB_REDIS_CLIENT = Symbol("PUBSUB_REDIS_CLIENT");
export const ELASTICSEARCH_CLIENT = Symbol("ELASTICSEARCH_CLIENT");
export const CACHE_SERVICE = Symbol("CACHE_SERVICE");
export const ELASTICSEARCH_SERVICE = Symbol("ELASTICSEARCH_SERVICE");

export type PrismaProvider = typeof prisma;
export type RedisProvider = ReturnType<typeof redisClient.getInstance>;
export type PubSubRedisProvider = ReturnType<typeof pubSubRedis.getInstance>;
export type ElasticsearchClientProvider = Client;
export type CacheProvider = CacheService;
export type ElasticsearchProvider = ElasticsearchService;
