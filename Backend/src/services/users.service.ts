import { Request } from "express";
import { prisma } from "../libs/prisma";
import { hashPassword } from "../utils/hash";
import { cacheService } from "./cache.service";
import { CACHE } from "../constants/cache.constants";
import crypto, { BinaryLike } from "crypto";
import { IncludeRelations } from "../types/query";
import { Prisma } from "../generated/prisma";
import { UpdatedError } from "../errors/app.error";
import { elasticsearchService } from "./elasticsearch.service";
interface SearchQuery {
  page?: string;
  limit?: string;
  name?: string;
  email?: string;
  status?: string;
  include?: string;
}

export const usersService = {
  async getUsers(req: Request) {
    const {
      page = 1,
      limit = 20,
      status,
      include,
      ...filter
    } = req.query as SearchQuery;
    let hashFilters = "";

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 1));
    const allowedRelations: (keyof IncludeRelations)[] = [
      "phone",
      "orders",
      "roles",
    ];
    const includeRelations: IncludeRelations = {};

    if (include) {
      include.split(",").forEach((rel) => {
        const key = rel.trim() as keyof IncludeRelations;
        if (allowedRelations.includes(key)) {
          includeRelations[key] = true;
        }
      });
    }
    const where: Prisma.UserWhereInput = {};

    if (typeof filter.name === "string") {
      where.name = {
        contains: filter.name,
        mode: "insensitive",
      };
    }
    if (typeof filter.email === "string") {
      where.email = {
        contains: filter.email,
        mode: "insensitive",
      };
    }

    if (status) {
      if (["true", "false"].includes(status)) {
        where.status = status === "true";
      }
    }

    if (Object.keys(where).length) {
      hashFilters = crypto
        .createHash("md5")
        .update(JSON.stringify(where) as BinaryLike)
        .digest("hex");
    }

    const listVersion = await cacheService.getTracker(
      CACHE.USER.TRACKERS.LIST_VERSION,
    );
    return cacheService.getOrSetWithTag(
      CACHE.USER.KEYS.LIST(+listVersion, limitNum, pageNum, hashFilters),
      async () => {
        const [users, count] = await Promise.all([
          prisma.user.findMany({
            where,
            omit: {
              password: true,
            },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
            include: includeRelations,
          }),
          prisma.user.count({ where }),
        ]);

        return {
          users,
          count,
          page,
        };
      },
      CACHE.USER.TAGS.LIST(),
    );
  },
  async getUser(id: string, req: Request) {
    const { include = "" } = req.query as { include: string };
    const allowedRelations: (keyof IncludeRelations)[] = [
      "phone",
      "orders",
      "roles",
    ];
    const includeRelations: IncludeRelations = {};

    if (include) {
      include.split(",").forEach((rel) => {
        const key = rel.trim() as keyof IncludeRelations;
        if (allowedRelations.includes(key)) {
          includeRelations[key] = true;
        }
      });
    }
    try {
      return await cacheService.getOrSetWithTag(
        CACHE.USER.KEYS.DETAIL(id),
        () =>
          prisma.user.findUnique({
            where: { id },
            include: includeRelations,
          }),
        CACHE.USER.TAGS.DETAIL(id),
      );
    } catch {
      return false;
    }
  },
  async createUser(data: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  }) {
    const { phone, ...userData } = data;
    const dataInsert: Prisma.UserCreateInput = {
      ...userData,
      password: hashPassword(data.password),
    };
    if (phone) {
      dataInsert.phone = {
        create: {
          phone,
        },
      };
    }
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error("Email already exists");
    }

    const user = await prisma.user.create({
      data: dataInsert,
      include: {
        phone: true,
      },
    });
    if (user) {
      cacheService.invalidateGetTracker(CACHE.USER.TRACKERS.LIST_VERSION);
      return user;
    }
    return null;
  },
  async updateUser(
    data: { name?: string; email?: string; phone?: string },
    id: string,
  ) {
    try {
      const { phone, ...userData } = data;

      const dataUpdate: Prisma.UserUpdateInput = {
        ...userData,
      };
      if (phone) {
        dataUpdate.phone = {
          upsert: {
            create: { phone },
            update: { phone },
          },
        };
      }
      const user = await cacheService.writeThrough(
        CACHE.USER.KEYS.DETAIL(id),
        async () => {
          const updated = prisma.user.update({
            where: { id },
            data: dataUpdate,
            include: {
              phone: true,
            },
            omit: {
              password: true,
            },
          });
          await cacheService.invalidateGetTracker(
            CACHE.USER.TRACKERS.LIST_VERSION,
          );
          return updated;
        },
      );
      await elasticsearchService.syncDecksByUser(id).catch((error) => {
        console.warn("Unable to sync deck author to Elasticsearch", error);
      });
      return user;
    } catch (error: any) {
      if (error.code === "P2025") {
        throw new UpdatedError("User not found", 404, error);
      }

      if (error.code === "P2002") {
        throw new UpdatedError("Email already exists", 409, error);
      }

      throw new UpdatedError("Internal Server Error", 500, error);
    }
  },

  async deleteUser(id: string) {
    const deletePhone = await prisma.phone.deleteMany({
      where: {
        user: {
          id,
        },
      },
    });
    if (deletePhone) {
      const user = await prisma.user.delete({
        where: { id },
      });
      if (user) {
        //invalidate
        await cacheService.invalidateTag(CACHE.USER.TAGS.ROOT());
      }
      return user;
    }
  },
};
