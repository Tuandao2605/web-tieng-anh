import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import {
  PRISMA_CLIENT,
  PrismaProvider,
} from "../../infrastructure/infrastructure.tokens";

@Injectable()
export class PostRepository {
  constructor(
    @Inject(PRISMA_CLIENT)
    private readonly prismaClient: PrismaProvider,
  ) {}

  findByUserId(userId: string) {
    return this.prismaClient.post.findMany({ where: { user: { id: userId } } });
  }

  create(data: Prisma.PostCreateInput) {
    return this.prismaClient.post.create({ data });
  }
}
