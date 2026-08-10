import { NextFunction, Request, Response } from "express";
import { ZodError, ZodObject } from "zod";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { errorResponse } from "../utils/response";

export const validate =
  (schema: ZodObject) =>
  async (req: Request, res: Response, next: NextFunction) => {
    Object.defineProperty(req, "query", {
      ...Object.getOwnPropertyDescriptor(req, "query"),
      value: req.query,
      writable: true,
    });
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = parsed.body ?? {};
      req.query = (parsed.query ?? {}) as ParsedQs;
      req.params = (parsed.params ?? {}) as ParamsDictionary;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        if (req.baseUrl.startsWith("/api")) {
          return errorResponse(
            res,
            "Validated Failed",
            error.issues.map((err) => ({
              path: err.path[1],
              message: err.message,
            })),
            400,
          );
        }
        req.flash(
          "errors",
          JSON.stringify(
            Object.fromEntries(
              error.issues.map((err) => [err.path[1], err.message]),
            ),
          ),
        );
        return res.redirect(req.headers["referer"] || "/");
      }

      if (!req.baseUrl.startsWith("/api")) {
        // eslint-disable-next-line preserve-caught-error
        throw new Error("Server Error");
      }

      return errorResponse(res, "Server Error", {});
    }
  };
