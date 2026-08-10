import { NextFunction, Request, Response } from "express";
import { redisClient } from "../utils/redis";
import { errorResponse } from "../utils/response";
const redis = redisClient.getInstance();
const MAX_REQUEST = 10;
const WINDOWMS = 60000;
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  //Fixed Window
  // const ip = req.ip;
  // const key = `rateLimit:${ip}`;
  // // tang bo dem
  // const count = await redis.incr(key);
  // if (count === 1) {
  //   await redis.expire(key, Math.floor(WINDOWMS / 1000));
  // }
  // console.log(count);
  // if (count > MAX_REQUEST) {
  //   if (count >= 20) {
  //     const ttl = await redis.ttl(key);
  //     redis.expire(key, ttl * 2);
  //     console.log("Tang thoi gian");
  //   }
  //   const timeLeft = await redis.ttl(key);
  //   return errorResponse(
  //     res,
  //     "Too many request , please try again later",
  //     {
  //       code: "MANY_REQUESTS",
  //       time_left_seconds: timeLeft,
  //     },
  //     429,
  //   );
  // }

  //Sliding Window Log

  const now = Date.now();
  const ip = req.ip;
  const key = `rateLimit:zset:${ip}`;
  const requestId = Math.random().toString(36).substring(7);
  //Kiem tra trung phat
  const currentTTL = await redis.pTTL(key);
  if (currentTTL > WINDOWMS) {
    await redis.pExpire(key, WINDOWMS * 2);
    const timeLeft = await redis.pTTL(key);
    return errorResponse(
      res,
      "Too many request , please try again later",
      {
        code: "MANY_REQUESTS",
        time_left_seconds: Math.ceil(Math.max(0, timeLeft) / 1000),
      },
      429,
    );
  }
  const [, currentCount] = (await redis
    .multi()
    .zRemRangeByScore(key, 0, now - WINDOWMS)
    .zCard(key)
    .exec()) as [unknown, number];

  if (currentCount < MAX_REQUEST) {
    await redis
      .multi()
      .zAdd(key, {
        score: now,
        value: `${now}:${requestId}`,
      })
      .pExpire(key, WINDOWMS)
      .exec();
  } else {
    let timeLeft = 0;
    await redis.zAdd(key, {
      score: now,
      value: `${now}:${requestId}`,
    });
    if (currentCount >= 20) {
      await redis.pExpire(key, WINDOWMS * 2);
      timeLeft = await redis.pTTL(key);
    } else {
      const oldestEntry = await redis.zRangeWithScores(key, 0, 0);

      if (oldestEntry.length > 0) {
        const oldestScore = oldestEntry[0]?.score as number;
        timeLeft = oldestScore + WINDOWMS - now;
      }
    }

    return errorResponse(
      res,
      "Too many request , please try again later",
      {
        code: "MANY_REQUESTS",
        time_left_seconds: Math.ceil(Math.max(0, timeLeft) / 1000),
      },
      429,
    );
  }

  next();
};
