import { Inject, Injectable } from "@nestjs/common";
import { LoginData, RegisterData } from "../../types/auth";
import { hashPassword, verifyPassword } from "../../utils/hash";
import { USER_REPOSITORY } from "../users/users.tokens";
import { UserRepository } from "../users/users.repository";

type SessionRequest = {
  session: {
    regenerate(callback: (error: unknown) => void): unknown;
    save(callback: (error: unknown) => void): unknown;
    user?: { id: string; name: string | null; email: string };
  };
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async register(data: RegisterData, signal?: AbortSignal) {
    // 1. Kiểm tra nếu đã bị hủy trước khi làm tác vụ nặng
    signal?.throwIfAborted();

    const password = await hashPassword(data.password);

    // 2. Kiểm tra lại lần nữa trước khi ghi DB
    signal?.throwIfAborted();

    return await this.users.create({
      data: {
        ...data,
        password,
      },
      // Hỗ trợ ngắt query nếu Prisma Client/Driver hỗ trợ signal
    });
  }

  async existingEmail(email: string) {
    return this.users.count({ where: { email } });
  }

  async login({ email, password }: LoginData, req: SessionRequest) {
    const user = await this.users.findByEmail(email);
    if (!user) return false;
    const hash = user.password;
    if (!(await verifyPassword(password, hash as string))) {
      return false;
    }
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    return true;
  }

  async profile(id: string) {
    const user = await this.users.findUnique({ where: { id } });
    return user;
  }
}
