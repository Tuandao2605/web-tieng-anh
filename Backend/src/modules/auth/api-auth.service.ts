import { Inject, Injectable } from "@nestjs/common";
import { verifyPassword } from "../../utils/hash";
import { JwtPayLoad, LoginData } from "../../types/auth";
import type { MailService } from "../mail/mail.service";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "../../utils/hash";
import {
  REDIS_CLIENT,
  RedisProvider,
} from "../../config/infrastructure.tokens";
import { AccessTokenService } from "../../common/services/access-token.service";
import { USER_REPOSITORY } from "../users/users.tokens";
import { MAIL_SERVICE } from "../mail/mail.tokens";
import { UserRepository } from "../users/users.repository";
import {
  decodeToken,
  generateRefreshToken,
  generateToken,
  verifyRefreshToken,
} from "../../utils/jwt";

@Injectable()
export class ApiAuthService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisProvider,
    @Inject(MAIL_SERVICE)
    private readonly mail: MailService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async login({ email, password }: LoginData) {
    const user = await this.users.findByEmail(email);
    if (!user) return false;
    const hash = user.password;
    if (!(await verifyPassword(password, hash as string))) {
      return false;
    }
    // Create token
    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    };
    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    //add refreshToken to redis
    const decodeRefreshToken = decodeToken(refreshToken);

    // await prisma.refreshToken.create({
    //   data: {
    //     jti: (decodeRefreshToken as { jti: string })?.jti,
    //     userId: user.id,
    //     ttl: new Date((decodeRefreshToken as { exp: number })?.exp * 1000),
    //   },
    // });
    const jti = (decodeRefreshToken as { jti: string })?.jti;
    const now = Math.floor(Date.now() / 1000);
    const ttl = (decodeRefreshToken as { exp: number })?.exp - now;
    await this.redis.set(
      `refresh_token:${jti}`,
      JSON.stringify({
        userId: user.id,
        jti,
      }),
      {
        EX: ttl,
      },
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  async requestPasswordReset(email: string) {
    const user = await this.users.findByEmail(email);
    // Không cho client biết email có tồn tại hay không.
    if (!user) return;

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.redis.set(
      `password_reset:${tokenHash}`,
      JSON.stringify({ userId: user.id }),
      { EX: 900 },
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5500";
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.sendMail(
      user.email,
      "Đặt lại mật khẩu Quizlet Pro",
      `<p>Xin chào,</p>
       <p>Nhấn vào liên kết dưới đây để đặt lại mật khẩu. Liên kết có hiệu lực trong <b>15 phút</b> và chỉ dùng một lần.</p>
       <p><a href="${resetUrl}">Đặt lại mật khẩu</a></p>
       <p>Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p>`,
    );
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resetKey = `password_reset:${tokenHash}`;
    // Atomically consume the one-time token so concurrent requests cannot both
    // obtain the reset payload.
    const raw = await this.redis.getDel(resetKey);
    if (!raw) return false;

    const { userId } = JSON.parse(raw) as { userId: string };
    const passwordHash = await hashPassword(password);
    await this.users.updatePassword(userId, passwordHash);
    return true;
  }

  async getProfile(token: string) {
    if (!token) return false;

    const principal = this.accessTokens.verifyCached(token);
    if (!principal) return false;

    // Standalone callers (for example WebSocket authentication) still perform
    // a strongly consistent revocation check. HTTP middleware pipelines this
    // EXISTS with its token-bucket command and reuses the resulting context.
    const isRevoked = await this.redis.exists(
      `blacklist_token:${principal.jti}`,
    );
    if (isRevoked) {
      this.accessTokens.evict(token);
      return false;
    }
    return principal.user;
  }

  async logout(token: string, userId: string) {
    const decoded = decodeToken(token);
    const jti = (decoded as { jti: string }).jti;
    const now = Math.floor(Date.now() / 1000);
    const ttl = (decoded as { exp: number }).exp - now;
    // Evict raw token from in-process cache
    this.accessTokens.evict(token);
    const blacklist = await this.redis.set(
      `blacklist_token:${jti}`,
      JSON.stringify({
        userId,
        jti,
      }),
      {
        EX: ttl,
      },
    );
    return blacklist;
  }

  async refreshToken(refreshToken: string) {
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) return false;

    const jti = (decoded as { jti: string }).jti;
    const userId = (decoded as { id: string }).id;
    if (!jti || !userId) return false;

    // Atomically consume the old refresh token. Of concurrent requests using
    // the same token, only the first one can rotate it.
    const oldTokenData = await this.redis.getDel(`refresh_token:${jti}`);
    if (!oldTokenData) return false;

    try {
      const storedToken = JSON.parse(oldTokenData) as {
        userId?: string;
        jti?: string;
      };
      if (storedToken.userId !== userId || storedToken.jti !== jti)
        return false;
    } catch {
      return false;
    }

    const payload = {
      id: userId,
      email: (decoded as JwtPayLoad).email,
      name: (decoded as Partial<JwtPayLoad>).name ?? null,
      status: (decoded as Partial<JwtPayLoad>).status ?? true,
    };
    const newaccessToken = generateToken(payload);
    const newRefreshToken = generateRefreshToken(payload);
    const jtiRefreshToken = decodeToken(newRefreshToken);

    const newJti = (jtiRefreshToken as { jti: string })?.jti;
    const now = Math.floor(Date.now() / 1000);
    const ttl = (jtiRefreshToken as { exp: number })?.exp - now;
    if (!newJti || !Number.isFinite(ttl) || ttl <= 0) return false;

    await this.redis.set(
      `refresh_token:${newJti}`,
      JSON.stringify({
        userId,
        jti: newJti,
      }),
      {
        EX: ttl,
      },
    );

    return {
      accessToken: newaccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async cleanBlacklist() {
    await this.users.deleteExpiredBlacklists(new Date());
  }

  async cleanRefreshToken() {
    await this.users.deleteExpiredRefreshTokens(new Date());
  }
}
