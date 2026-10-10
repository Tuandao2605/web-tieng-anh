import { Inject, Injectable } from "@nestjs/common";
import { User } from "../../generated/prisma/client";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../../libs/prisma";
import { PRISMA_CLIENT, PrismaProvider } from "../../infrastructure/infrastructure.tokens";
import { BaseRepository } from "../../repositories/base.repository";

@Injectable()
export class UserRepository extends BaseRepository<User, typeof prisma.user> {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prismaClient: PrismaProvider,
  ) {
    super(prismaClient.user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.model.findUnique({
      where: {
        email,
      },
    });
  }

  findMany(args: Prisma.UserFindManyArgs) {
    return this.model.findMany(args);
  }

  count(args: Prisma.UserCountArgs) {
    return this.model.count(args);
  }

  findUnique(args: Prisma.UserFindUniqueArgs) {
    return this.model.findUnique(args);
  }

  create(args: Prisma.UserCreateArgs) {
    return this.model.create(args);
  }

  update(args: Prisma.UserUpdateArgs) {
    return this.model.update(args);
  }

  deleteUser(args: Prisma.UserDeleteArgs) {
    return this.model.delete(args);
  }

  deletePhonesForUser(userId: string) {
    return this.prismaClient.phone.deleteMany({ where: { user: { id: userId } } });
  }

  updatePassword(userId: string, password: string) {
    return this.model.update({ where: { id: userId }, data: { password } });
  }

  deleteExpiredBlacklists(now: Date) {
    return this.prismaClient.tokenBlacklist.deleteMany({
      where: { ttl: { lte: now } },
    });
  }

  deleteExpiredRefreshTokens(now: Date) {
    return this.prismaClient.refreshToken.deleteMany({
      where: { ttl: { lte: now } },
    });
  }
}
