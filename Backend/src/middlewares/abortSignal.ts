import type { NextFunction, Request, Response } from "express";

declare module "express" {
  interface Request {
    abortSignal?: AbortSignal;
  }
}

export const attachAbortSignal = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const controller = new AbortController();

  const cleanup = () => {
    res.off("close", onClose);
    res.off("finish", onFinish);
  };

  const onClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
    cleanup();
  };

  const onFinish = () => {
    cleanup();
  };

  res.once("close", onClose);
  res.once("finish", onFinish);

  req.abortSignal = controller.signal;
  next();
};
