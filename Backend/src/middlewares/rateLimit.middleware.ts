import { NextFunction, Request, Response } from "express";
import { redisClient } from "../utils/redis";
import { errorResponse } from "../utils/response";

const redis = redisClient.getInstance();
const MAX_REQUEST = Number(process.env.RATE_LIMIT_MAX) || 100; // Tăng ngưỡng tối đa (mặc định 100 reqs/phút)
const WINDOWMS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000; // 1 phút (60000ms)

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const key = `rateLimit:zset:${ip}`;
    const requestId = Math.random().toString(36).substring(7);

    // 1. Dọn dẹp log cũ hơn cửa sổ thời gian (WINDOWMS) & lấy số request trong window
    const [, currentCount] = (await redis
      .multi()
      .zRemRangeByScore(key, 0, now - WINDOWMS)
      .zCard(key)
      .exec()) as [unknown, number];

    // 2. Nếu chưa vượt quá giới hạn -> Cho phép request & ghi log mới
    if (currentCount < MAX_REQUEST) {
      await redis
        .multi()
        .zAdd(key, {
          score: now,
          value: `${now}:${requestId}`,
        })
        .pExpire(key, WINDOWMS)
        .exec();

      return next();
    }

    // 3. Nếu vượt quá giới hạn -> Tính chính xác thời gian còn lại (timeLeft) dựa trên request cũ nhất
    const oldestEntry = await redis.zRangeWithScores(key, 0, 0);
    let timeLeftMs = WINDOWMS;

    if (oldestEntry.length > 0 && oldestEntry[0]?.score) {
      const oldestScore = oldestEntry[0].score;
      timeLeftMs = Math.max(0, oldestScore + WINDOWMS - now);
    }

    return errorResponse(
      res,
      "Too many requests, please try again later",
      {
        code: "MANY_REQUESTS",
        time_left_seconds: Math.ceil(timeLeftMs / 1000),
      },
      429,
    );
  } catch (error) {
    // Nếu Redis có sự cố, log lỗi và cho qua để không làm gián đoạn ứng dụng
    console.error("Rate limit middleware error:", error);
    next();
  }
};

