import assert from "node:assert/strict";
import { mock, test } from "node:test";
import fastifyCookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { runtimeConfig } from "../src/config/runtime";
import {
  attachWebSession,
  saveWebSession,
} from "../src/modules/web/web-session.service";
import type { WebIncomingMessage } from "../src/modules/web/web-session.types";
import { redisClient } from "../src/utils/redis";

test("web sessions persist in Redis and retain flash messages for one read", async (t) => {
  const values = new Map<string, string>();
  const fakeRedis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key: string) => Number(values.delete(key)),
  };
  const getInstance = mock.method(
    redisClient,
    "getInstance",
    () => fakeRedis as unknown as ReturnType<typeof redisClient.getInstance>,
  );
  t.after(() => getInstance.mock.restore());

  let cookieName = "";
  let cookieValue = "";
  const request = {
    cookies: {},
    unsignCookie: (value: string) =>
      fastifyCookie.unsign(value, runtimeConfig.sessionSecret),
    raw: {},
  } as unknown as FastifyRequest;
  const reply = {
    setCookie(name: string, value: string) {
      cookieName = name;
      cookieValue = value;
      return this;
    },
    clearCookie() {
      return this;
    },
    signCookie(value: string) {
      return fastifyCookie.sign(value, runtimeConfig.sessionSecret);
    },
  } as unknown as FastifyReply;

  await attachWebSession(request, reply);
  const webRequest = request.raw as WebIncomingMessage;
  const session = webRequest.session;
  session.user = {
    id: "user-1",
    name: "Learner",
    email: "learner@example.com",
  };
  session.csrfToken = "csrf-token";
  webRequest.flash("message", "Saved message");
  await saveWebSession(session);

  assert.equal(cookieName, runtimeConfig.sessionCookieName);
  assert.match(cookieValue, /^s:[0-9a-f-]+\.[^;]+$/i);
  const sessionId = cookieValue.slice(2).split(".")[0];
  const redisKey = `session:web:${sessionId}`;
  const stored = JSON.parse(values.get(redisKey) ?? "{}") as {
    user?: { id?: string };
    csrfToken?: string;
    _flash?: Record<string, string[]>;
  };
  assert.equal(stored.user?.id, "user-1");
  assert.equal(stored.csrfToken, "csrf-token");
  assert.deepEqual(stored._flash?.message, ["Saved message"]);

  const nextRequest = {
    cookies: { [runtimeConfig.sessionCookieName]: cookieValue },
    unsignCookie: (value: string) =>
      fastifyCookie.unsign(value, runtimeConfig.sessionSecret),
    raw: {},
  } as unknown as FastifyRequest;
  const nextReply = {
    setCookie() {
      return this;
    },
    clearCookie() {
      return this;
    },
    signCookie(value: string) {
      return fastifyCookie.sign(value, runtimeConfig.sessionSecret);
    },
  } as unknown as FastifyReply;

  await attachWebSession(nextRequest, nextReply);
  const restoredRequest = nextRequest.raw as WebIncomingMessage;
  const restored = restoredRequest.session;
  assert.deepEqual(restoredRequest.flash("message"), ["Saved message"]);
  assert.deepEqual(restoredRequest.flash("message"), []);
  await saveWebSession(restored);

  const afterFlashRead = JSON.parse(values.get(redisKey) ?? "{}") as {
    _flash?: Record<string, string[]>;
  };
  assert.equal(afterFlashRead._flash, undefined);
});

test("web session regeneration replaces the old Redis session id", async (t) => {
  const values = new Map<string, string>();
  const fakeRedis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key: string) => Number(values.delete(key)),
  };
  const getInstance = mock.method(
    redisClient,
    "getInstance",
    () => fakeRedis as unknown as ReturnType<typeof redisClient.getInstance>,
  );
  t.after(() => getInstance.mock.restore());

  const request = {
    cookies: {},
    unsignCookie: (value: string) =>
      fastifyCookie.unsign(value, runtimeConfig.sessionSecret),
    raw: {},
  } as unknown as FastifyRequest;
  const reply = {
    setCookie() {
      return this;
    },
    clearCookie() {
      return this;
    },
    signCookie(value: string) {
      return fastifyCookie.sign(value, runtimeConfig.sessionSecret);
    },
  } as unknown as FastifyReply;

  await attachWebSession(request, reply);
  const session = (request.raw as WebIncomingMessage).session;
  await saveWebSession(session);
  const oldKey = [...values.keys()][0];
  assert.ok(oldKey);

  await new Promise<void>((resolve, reject) =>
    session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  session.user = { id: "user-2", name: null, email: "user2@example.com" };
  await saveWebSession(session);

  const newKey = [...values.keys()][0];
  assert.ok(newKey);
  assert.notEqual(newKey, oldKey);
  assert.equal(values.has(oldKey), false);
});
