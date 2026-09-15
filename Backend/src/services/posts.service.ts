import { Request } from "express";
import { CACHE } from "../constants/cache.constants";
import { hasErrorCode, UpdatedError } from "../errors/app.error";
import { Prisma, User } from "../generated/prisma";
import { prisma } from "../libs/prisma";
import { cacheService } from "./cache.service";

export const postsService = {
  async getPost(req: Request) {
    const listVersion = await cacheService.getTracker(
      CACHE.POST.TRACKERS.LIST_VERSION,
    );

    const userId = req.user?.id;
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
    );
  },
  async createPost({
    user,
    ...postData
  }: { user: User } & Prisma.PostCreateInput) {
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
