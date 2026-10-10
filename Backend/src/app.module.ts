import { Module } from "@nestjs/common";
import { ApiEnvelopeInterceptor } from "./common/interceptors/api-envelope.interceptor";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { InfrastructureModule } from "./config/infrastructure.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { PostsModule } from "./modules/posts/posts.module";
import { StudyModule } from "./modules/study/study.module";
import { UsersModule } from "./modules/users/users.module";
import { WebModule } from "./modules/web/web.module";
import { CacheModule } from "./modules/cache/cache.module";
import { ElasticsearchModule } from "./modules/elasticsearch/elasticsearch.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";

@Module({
  imports: [
    InfrastructureModule,
    CacheModule,
    ElasticsearchModule,
    RateLimitModule,
    HealthModule,
    AuthModule,
    UsersModule,
    StudyModule,
    PostsModule,
    WebModule,
  ],
  providers: [ApiEnvelopeInterceptor, ApiExceptionFilter],
})
export class AppModule {}
