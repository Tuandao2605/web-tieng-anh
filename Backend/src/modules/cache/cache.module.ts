import { Global, Module } from "@nestjs/common";
import { InfrastructureModule } from "../../config/infrastructure.module";
import { CacheService } from "./cache.service";
import { CACHE_SERVICE } from "./cache.tokens";

@Global()
@Module({
  imports: [InfrastructureModule],
  providers: [CacheService, { provide: CACHE_SERVICE, useExisting: CacheService }],
  exports: [CacheService, CACHE_SERVICE],
})
export class CacheModule {}
