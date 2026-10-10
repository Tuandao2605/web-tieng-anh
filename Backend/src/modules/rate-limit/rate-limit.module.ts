import { Global, Module } from "@nestjs/common";
import { InfrastructureModule } from "../../config/infrastructure.module";
import { RateLimitService } from "./rate-limit.service";

@Global()
@Module({
  imports: [InfrastructureModule],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
