import { CACHE } from "../constants/cache.constants";
import { hasErrorCode, UpdatedError } from "../errors/app.error";
import { Prisma, User } from "../generated/prisma";
import { prisma } from "../libs/prisma";
import { cacheService } from "./cache.service";

const configuredSWRMs = Number(process.env.POST_LIST_CACHE_SWR_MS);
const POST_LIST_SWR_MS = Number.isFinite(configuredSWRMs)
  ? Math.min(60_000, Math.max(0, configuredSWRMs))
  : 5_000;

export const postsService = {
  async getPost(userId: string | undefined) {
    const listVersion = await cacheService.getTracker(
      CACHE.POST.TRACKERS.LIST_VERSION,
    );

    if (!userId) {
      throw new UpdatedError("Unauthorized", 401);
    }

    return cacheService.getOrSetWithTag(
      CACHE.POST.KEYS.LIST(userId, +listVersion),
      async () => {
        return await prisma.post.findMany({
          where: {
            user: {
              id: userId,
            },
          },
        });
      },
      CACHE.POST.TAGS.LIST(),
      3600,
      undefined,
      POST_LIST_SWR_MS,
    );
  },
  async createPost({
    user,
    ...postData
  }: { user: Pick<User, "id"> } & Omit<Prisma.PostCreateInput, "user">) {
    try {
      const post = await prisma.post.create({
        data: {
          ...postData,
          user: {
            connect: { id: user.id },
          },
        },
      });

      await cacheService.invalidateGetTracker(CACHE.POST.TRACKERS.LIST_VERSION);

      return post;
    } catch (error: unknown) {
      if (hasErrorCode(error, "P2025")) {
        throw new UpdatedError("User not found");
      }

      throw new UpdatedError("Create post failed");
    }
  },
};
