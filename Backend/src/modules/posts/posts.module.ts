import { Module } from "@nestjs/common";
import { postsService } from "../../services/posts.service";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { PostsController } from "./posts.controller";
import { POSTS_SERVICE } from "./posts.tokens";

@Module({
  controllers: [PostsController],
  providers: [
    { provide: POSTS_SERVICE, useValue: postsService },
    ApiRateLimitGuard,
    JwtAuthGuard,
  ],
})
export class PostsModule {}
