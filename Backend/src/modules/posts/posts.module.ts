import { Module } from "@nestjs/common";
import { PostsService } from "./posts.service";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { PostsController } from "./posts.controller";
import { POSTS_REPOSITORY, POSTS_SERVICE } from "./posts.tokens";
import { PostRepository } from "./posts.repository";

@Module({
  controllers: [PostsController],
  providers: [
    PostRepository,
    { provide: POSTS_REPOSITORY, useExisting: PostRepository },
    PostsService,
    { provide: POSTS_SERVICE, useExisting: PostsService },
    ApiRateLimitGuard,
    JwtAuthGuard,
  ],
})
export class PostsModule {}
