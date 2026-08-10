import { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";
import { apiAuthService } from "../services/apiAuth.service";

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
    const token = req.headers["authorization"]?.split(" ").slice(-1).join();
    const user = await apiAuthService.getProfile(token as string);
    if (user) {
      req.user = user;
    }
  }

  next();
};
