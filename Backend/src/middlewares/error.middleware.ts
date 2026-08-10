import { NextFunction, Request, Response } from "express";
import { ErrorWithStatus } from "../types/error";

export const notFoundMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  //404
  const error: ErrorWithStatus = new Error("Duong dan khong ton tai");
  error.status = 404;
  next(error);
};

export const errorHandlingMiddleware = (
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  let message = err instanceof Error ? err.message : err;
  if (process.env.NODE_ENV === "production") {
    message = "";
  }
  const status = err.status || 500;
  console.log(`[ERROR]: ${err.message}`);
  if (req.url.startsWith("/api")) {
    return res.status(status).json({
      success: false,
      status: status,
      message: message || "SERVER ERROR",
    });
  }
  const pathView = `errors/${status}`;
  return res.render(pathView, {
    layout: false,
    message: message || "Server Error",
  });
};
