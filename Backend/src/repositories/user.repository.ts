import { User } from "../generated/prisma/client";
import { prisma } from "../libs/prisma";
import { BaseRepository } from "./base.repository";


class UserRepository extends BaseRepository<User, typeof prisma.user> {
  constructor() {
    super(prisma.user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.model.findUnique({
      where: {
        email,
      },
    });
  }
}

export default new UserRepository();
