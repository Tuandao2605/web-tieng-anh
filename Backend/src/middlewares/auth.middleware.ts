import { NextFunction, Request, Response } from "express";
import { apiAuthService } from "../services/apiAuth.service";
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
  const token = req.headers["authorization"]?.split(" ").slice(-1).join();
  const user = await apiAuthService.getProfile(token as string);
  if (!user) {
    return errorResponse(res, "Invalid credentials or missing token", {}, 401);
  }
  req.user = user;
  req.token = token as string;
  next();
};
