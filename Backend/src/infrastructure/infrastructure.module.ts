import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";
import { prisma } from "../libs/prisma";
import { cacheService } from "../services/cache.service";
import { closeBullMqConnections } from "../utils/bullmq";
import { closeRedisConnections, redisClient } from "../utils/redis";
import { closeSearchIndexQueue } from "../queues/search-index.queue";
import { closeSocketServer } from "../web-socket/socket-server";
import {
  CACHE_SERVICE,
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
      closeSocketServer(),
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
    { provide: CACHE_SERVICE, useValue: cacheService },
    InfrastructureLifecycle,
  ],
  exports: [PRISMA_CLIENT, REDIS_CLIENT, CACHE_SERVICE],
})
export class InfrastructureModule {}
