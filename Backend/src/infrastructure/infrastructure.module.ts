import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";
import { prisma } from "../libs/prisma";
import { CacheService } from "../services/cache.service";
import {
  ElasticsearchService,
  elasticsearchClient,
} from "../services/elasticsearch.service";
import { closeBullMqConnections } from "../utils/bullmq";
import {
  closeRedisConnections,
  pubSubRedis,
  redisClient,
} from "../utils/redis";
import { closeSearchIndexQueue } from "../queues/search-index.queue";
import { RateLimitService } from "../services/rateLimit.service";
import {
  CACHE_SERVICE,
  ELASTICSEARCH_CLIENT,
  ELASTICSEARCH_SERVICE,
  PUBSUB_REDIS_CLIENT,
  PRISMA_CLIENT,
  REDIS_CLIENT,
} from "./infrastructure.tokens";

@Injectable()
class InfrastructureLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prismaClient: typeof prisma,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    const appResources = await Promise.allSettled([
      closeSearchIndexQueue(),
      closeBullMqConnections(),
    ]);
    const infrastructure = await Promise.allSettled([
      this.prismaClient.$disconnect(),
      closeRedisConnections(),
    ]);

    for (const result of [...appResources, ...infrastructure]) {
      if (result.status === "rejected") {
        console.error(
          "Failed to close a Nest infrastructure connection",
          result.reason,
        );
      }
    }
  }
}

@Global()
@Module({
  providers: [
    { provide: PRISMA_CLIENT, useValue: prisma },
    { provide: REDIS_CLIENT, useFactory: () => redisClient.getInstance() },
    {
      provide: PUBSUB_REDIS_CLIENT,
      useFactory: () => pubSubRedis.getInstance(),
    },
    { provide: ELASTICSEARCH_CLIENT, useValue: elasticsearchClient },
    CacheService,
    { provide: CACHE_SERVICE, useExisting: CacheService },
    ElasticsearchService,
    { provide: ELASTICSEARCH_SERVICE, useExisting: ElasticsearchService },
    RateLimitService,
    InfrastructureLifecycle,
  ],
  exports: [
    PRISMA_CLIENT,
    REDIS_CLIENT,
    PUBSUB_REDIS_CLIENT,
    ELASTICSEARCH_CLIENT,
    CACHE_SERVICE,
    ELASTICSEARCH_SERVICE,
    RateLimitService,
  ],
})
export class InfrastructureModule {}
