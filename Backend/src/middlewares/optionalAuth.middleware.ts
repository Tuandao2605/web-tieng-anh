import { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";
import { apiAuthService } from "../services/apiAuth.service";
import { extractBearerToken } from "../services/accessToken.service";

export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.baseUrl.startsWith("/api")) {
    res.locals.user = null;
    if (req.session.user) {
      const userId = req.session.user.id;
      const user = await authService.profile(userId);
      if (user) {
        req.user = user;
        res.locals.user = user;
      }
    }
  } else {
    const context = req.authContext;
    if (context?.blacklistChecked) {
      if (context.principal && !context.revoked && context.token) {
        req.user = context.principal.user;
        req.token = context.token;
      }
      return next();
    }

    // Same fallback as authMiddleware for standalone mounting or a transient
    // fail-open error in the rate limiter.
    const token =
      context?.token ?? extractBearerToken(req.headers.authorization);
    const user = token ? await apiAuthService.getProfile(token) : false;
    if (user) {
      req.user = user;
      req.token = token as string;
    }
    if (context) {
      context.blacklistChecked = true;
      context.revoked = !user && context.principal !== null;
    }
  }

  return next();
};
