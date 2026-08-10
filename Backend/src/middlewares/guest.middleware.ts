import { NextFunction, Request, Response } from "express";

export const guestMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // const isAuth = false;
  // if (isAuth) {
  //   return res.redirect("/admin");
  // }
  next();
};
