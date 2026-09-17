import { NextFunction, Request, Response } from "express";
import { apiAuthService } from "../services/apiAuth.service";
import { extractBearerToken } from "../services/accessToken.service";
import { errorResponse } from "../utils/response";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.baseUrl.startsWith("/api")) {
    const isAuth = req.user;
    if (!isAuth) {
      return res.redirect("/auth/login");
    }
    return next();
  }

  //Xu li API
  const context = req.authContext;
  if (context?.blacklistChecked) {
    if (context.principal && !context.revoked && context.token) {
      req.user = context.principal.user;
      req.token = context.token;
      return next();
    }
    return errorResponse(res, "Invalid credentials or missing token", {}, 401);
  }

  // Fallback for callers that mount this middleware without the global rate
  // limiter, or when the fail-open limiter could not reach Redis.
  const token = context?.token ?? extractBearerToken(req.headers.authorization);
  const user = token ? await apiAuthService.getProfile(token) : false;
  if (!user) {
    if (context) {
      context.blacklistChecked = true;
      context.revoked = context.principal !== null;
    }
    return errorResponse(res, "Invalid credentials or missing token", {}, 401);
  }
  req.user = user;
  req.token = token as string;
  if (context) {
    context.blacklistChecked = true;
    context.revoked = false;
  }
  return next();
};
