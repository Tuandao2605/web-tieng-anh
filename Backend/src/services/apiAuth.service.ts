import { verifyPassword } from "../utils/hash";
import { prisma } from "../libs/prisma";
import { JwtPayLoad, LoginData } from "../types/auth";
import { redisClient } from "../utils/redis";
const redis = redisClient.getInstance();
import {
  decodeToken,
  generateRefreshToken,
  generateToken,
  verifyRefreshToken,
  verifyToken,
} from "../utils/jwt";

export const apiAuthService = {
  login: async ({ email, password }: LoginData) => {
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });
    if (!user) return false;
    const hash = user.password;
    if (!verifyPassword(password, hash as string)) {
      return false;
    }
    // Create token
    const payload = {
      id: user.id,
      email: user.email,
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
    await redis.set(
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
  },
  getProfile: async (token: string) => {
    const decoded = verifyToken(token);
    if (!decoded) return false;

    //Kiem tra blacklist
    const jti = (decoded as JwtPayLoad & { jti: string })?.jti;
    const blacklist = await redis.get(`blacklist_token:${jti}`);
    if (blacklist) {
      return false;
    }
    const userId = (decoded as JwtPayLoad).id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      omit: {
        password: true,
      },
    });
    if (!user) return false;
    return user;
  },
  logout: async (token: string, userId: string) => {
    const decoded = decodeToken(token);
    const jti = (decoded as { jti: string }).jti;
    const now = Math.floor(Date.now() / 1000);
    const ttl = (decoded as { exp: number }).exp - now;
    const blacklist = await redis.set(
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
  },
  refreshToken: async (refreshToken: string) => {
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) return false;

    // check refreshToken in DB
    const jti = (decoded as { jti: string }).jti;
    const userId = (decoded as { id: string }).id;

    const RefreshTokenFromRedis = await redis.get(`refresh_token:${jti}`);
    if (!RefreshTokenFromRedis) {
      return false;
    }
    const payload = {
      id: userId,
      email: (decoded as JwtPayLoad).email,
    };
    const newaccessToken = generateToken(payload);
    const newRefreshToken = generateRefreshToken(payload);
    const jtiRefreshToken = decodeToken(newRefreshToken);

    //add new jti to Redis
    const newJti = (jtiRefreshToken as { jti: string })?.jti;
    const now = Math.floor(Date.now() / 1000);
    const ttl = (jtiRefreshToken as { exp: number })?.exp - now;
    await redis.set(
      `refresh_token:${newJti}`,
      JSON.stringify({
        userId,
        jti: newJti,
      }),
      {
        EX: ttl,
      },
    );

    //delete old jti from Redis
    await redis.del(`refresh_token:${jti}`);

    await redis.del(`refresh_token:${RefreshTokenFromRedis}`);
    return {
      accessToken: newaccessToken,
      refreshToken: newRefreshToken,
    };
  },

  cleanBlacklist: async () => {
    await prisma.tokenBlacklist.deleteMany({
      where: {
        ttl: {
          lte: new Date(),
        },
      },
    });
  },
  cleanRefreshToken: async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        ttl: {
          lte: new Date(),
        },
      },
    });
  },
};
