import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const sameToken = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

/** Synchronizer-token CSRF protection for server-rendered routes only. */
export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("base64url");
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const bodyToken =
    typeof req.body?._csrf === "string" ? req.body._csrf : undefined;
  const headerToken = req.get("x-csrf-token");
  const providedToken = bodyToken ?? headerToken;

  if (!providedToken || !sameToken(providedToken, req.session.csrfToken)) {
    return res.status(403).render("errors/403", {
      layout: false,
      message: "Yeu cau khong hop le hoac da het han. Vui long tai lai trang.",
    });
  }

  if (bodyToken) delete req.body._csrf;
  return next();
};
