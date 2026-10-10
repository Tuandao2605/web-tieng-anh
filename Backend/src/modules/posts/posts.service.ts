import { Inject, Injectable } from "@nestjs/common";
import { CACHE } from "../../constants/cache.constants";
import { hasErrorCode, UpdatedError } from "../../errors/app.error";
import { Prisma, User } from "../../generated/prisma";
import { CACHE_SERVICE, type CacheProvider } from "../cache/cache.tokens";
import { POSTS_REPOSITORY } from "./posts.tokens";
import { PostRepository } from "./posts.repository";

const configuredSWRMs = Number(process.env.POST_LIST_CACHE_SWR_MS);
const POST_LIST_SWR_MS = Number.isFinite(configuredSWRMs)
  ? Math.min(60_000, Math.max(0, configuredSWRMs))
  : 5_000;

@Injectable()
export class PostsService {
  constructor(
    @Inject(POSTS_REPOSITORY)
    private readonly posts: PostRepository,
    @Inject(CACHE_SERVICE)
    private readonly cache: CacheProvider,
  ) {}

  async getPost(userId: string | undefined) {
    const listVersion = await this.cache.getTracker(
      CACHE.POST.TRACKERS.LIST_VERSION,
    );

    if (!userId) {
      throw new UpdatedError("Unauthorized", 401);
    }

    return this.cache.getOrSetWithTag(
      CACHE.POST.KEYS.LIST(userId, +listVersion),
      () => this.posts.findByUserId(userId),
      CACHE.POST.TAGS.LIST(),
      3600,
      undefined,
      POST_LIST_SWR_MS,
    );
  }

  async createPost({
    user,
    ...postData
  }: { user: Pick<User, "id"> } & Omit<Prisma.PostCreateInput, "user">) {
    try {
      const post = await this.posts.create({
        ...postData,
        user: {
          connect: { id: user.id },
        },
      });

      await this.cache.invalidateGetTracker(CACHE.POST.TRACKERS.LIST_VERSION);

      return post;
    } catch (error: unknown) {
      if (hasErrorCode(error, "P2025")) {
        throw new UpdatedError("User not found");
      }

      throw new UpdatedError("Create post failed");
    }
  }
}
