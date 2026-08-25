import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  errorHandlingMiddleware,
  notFoundMiddleware,
} from "../src/middlewares/error.middleware";
import type { ErrorWithStatus } from "../src/types/error";

test("notFoundMiddleware forwards a 404 error", () => {
  let forwardedError: ErrorWithStatus | undefined;

  notFoundMiddleware(
    {} as Request,
    {} as Response,
    ((error: ErrorWithStatus) => {
      forwardedError = error;
    }) as NextFunction,
  );

  assert.equal(forwardedError?.status, 404);
});

test("HTML error responses preserve the error HTTP status", () => {
  let responseStatus: number | undefined;
  let renderedView: string | undefined;
  const response = {
    status(status: number) {
      responseStatus = status;
      return this;
    },
    render(view: string) {
      renderedView = view;
      return this;
    },
  } as unknown as Response;
  const error: ErrorWithStatus = new Error("Missing page");
  error.status = 404;

  errorHandlingMiddleware(
    error,
    { url: "/missing" } as Request,
    response,
    (() => undefined) as NextFunction,
  );

  assert.equal(responseStatus, 404);
  assert.equal(renderedView, "errors/404");
});

test("API error responses preserve the error HTTP status", () => {
  let responseStatus: number | undefined;
  let jsonBody: unknown;
  const response = {
    status(status: number) {
      responseStatus = status;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
  } as unknown as Response;
  const error: ErrorWithStatus = new Error("Forbidden origin");
  error.status = 403;

  errorHandlingMiddleware(
    error,
    { url: "/api/v1/sets" } as Request,
    response,
    (() => undefined) as NextFunction,
  );

  assert.equal(responseStatus, 403);
  assert.deepEqual(jsonBody, {
    success: false,
    status: 403,
    message: "Forbidden origin",
  });
});
