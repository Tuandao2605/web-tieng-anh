import { User } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";

class UserRepository extends BaseRepository<User> {
  constructor() {
    super("user");
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
