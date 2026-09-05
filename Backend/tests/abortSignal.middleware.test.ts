import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { attachAbortSignal } from "../src/middlewares/abortSignal";

const createResponse = () => {
  const response = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
  };
  response.writableEnded = false;
  return response;
};

test("attachAbortSignal aborts when the client disconnects", () => {
  const request = {} as Request;
  const response = createResponse();
  let nextCalled = false;

  attachAbortSignal(
    request,
    response as unknown as Response,
    (() => {
      nextCalled = true;
    }) as NextFunction,
  );

  response.emit("close");

  assert.equal(nextCalled, true);
  assert.equal(request.abortSignal?.aborted, true);
});

test("attachAbortSignal does not abort a normally completed response", () => {
  const request = {} as Request;
  const response = createResponse();

  attachAbortSignal(
    request,
    response as unknown as Response,
    (() => undefined) as NextFunction,
  );

  response.writableEnded = true;
  response.emit("finish");
  response.emit("close");

  assert.equal(request.abortSignal?.aborted, false);
});
