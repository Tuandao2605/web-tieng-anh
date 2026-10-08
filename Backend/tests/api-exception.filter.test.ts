import assert from "node:assert/strict";
import test from "node:test";
import {
  ArgumentsHost,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiExceptionFilter } from "../src/common/filters/api-exception.filter";

const runFilter = async (url: string, exception: unknown) => {
  const result: { status?: number; type?: string; body?: unknown } = {};
  const reply = {
    status(status: number) {
      result.status = status;
      return this;
    },
    type(type: string) {
      result.type = type;
      return this;
    },
    send(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as FastifyReply;
  const request = { url } as FastifyRequest;
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  await new ApiExceptionFilter().catch(exception, host);
  return result;
};

test("API exceptions preserve status and legacy response payload", async () => {
  const payload = {
    success: false,
    error: { code: "FORBIDDEN" },
    message: "No access",
  };
  const result = await runFilter(
    "/api/v1/sets",
    new HttpException(payload, 403),
  );

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, payload);
});

test("web not-found exceptions render the EJS error page", async () => {
  const result = await runFilter("/missing", new NotFoundException());

  assert.equal(result.status, 404);
  assert.equal(result.type, "text/html; charset=utf-8");
  assert.equal(typeof result.body, "string");
  assert.match(result.body as string, /Duong dan khong ton tai/);
});
