import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "../../types/auth";
import { ApiMessage } from "../../common/decorators/api-message.decorator";
import { apiHttpException } from "../../common/exceptions/api-http-exception";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { POSTS_SERVICE } from "./posts.tokens";
import type { PostsService } from "./posts.tokens";

type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};

@Controller("api/v1/posts")
@UseGuards(ApiRateLimitGuard)
export class PostsController {
  constructor(
    @Inject(POSTS_SERVICE) private readonly posts: PostsService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Get list posts success")
  list(@Req() request: AuthenticatedRequest) {
    return this.posts.getPost(request.user?.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiMessage("Create post success")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const user = request.user;
    if (!user) {
      throw apiHttpException(
        "Invalid credentials or missing token",
        {},
        HttpStatus.UNAUTHORIZED,
      );
    }

    const payload =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? body
        : {};

    return this.posts.createPost({
      ...payload,
      user,
    } as unknown as Parameters<PostsService["createPost"]>[0]);
  }

  // This endpoint is currently a placeholder and returns raw {}.
  // Keep that response unchanged instead of wrapping it in the API envelope.
  @Put()
  @HttpCode(HttpStatus.OK)
  update(@Res() reply: FastifyReply) {
    return reply.code(HttpStatus.OK).send({});
  }
}
