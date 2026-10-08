import { Module } from "@nestjs/common";
import { ApiEnvelopeInterceptor } from "./common/interceptors/api-envelope.interceptor";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { PostsModule } from "./modules/posts/posts.module";
import { StudyModule } from "./modules/study/study.module";
import { UsersModule } from "./modules/users/users.module";
import { WebModule } from "./modules/web/web.module";

@Module({
  imports: [
    InfrastructureModule,
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
