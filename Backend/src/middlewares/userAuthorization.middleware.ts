import { NextFunction, Request, Response } from "express";
import { errorResponse } from "../utils/response";

export const requireSelfUserMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || req.user.id !== req.params.id) {
    return errorResponse(
      res,
      "You are not authorized to access this user",
      { code: "FORBIDDEN" },
      403,
    );
  }

  return next();
};
