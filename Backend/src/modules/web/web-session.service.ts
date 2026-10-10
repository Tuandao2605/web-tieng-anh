import { randomUUID } from "node:crypto";
import type {} from "@fastify/cookie";
import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { runtimeConfig } from "../../config/runtime";
import {
  REDIS_CLIENT,
  type RedisProvider,
} from "../../infrastructure/infrastructure.tokens";
import type {
  WebFlash,
  WebIncomingMessage,
  WebSession,
  WebSessionData,
} from "./web-session.types";

const SESSION_PREFIX = "session:web:";
const SESSION_TTL_SECONDS = Math.ceil(runtimeConfig.sessionTtlMs / 1000);
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: runtimeConfig.isProduction,
  maxAge: SESSION_TTL_SECONDS,
  path: "/",
  priority: "high" as const,
};

const parseSession = (value: string | null): WebSessionData => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return {};
    const data = parsed as Record<string, unknown>;
    const session: WebSessionData = {};
    if (
      typeof data.user === "object" &&
      data.user !== null &&
      "id" in data.user &&
      typeof data.user.id === "string" &&
      "email" in data.user &&
      typeof data.user.email === "string"
    ) {
      session.user = {
        id: data.user.id,
        email: data.user.email,
        name:
          "name" in data.user &&
          (typeof data.user.name === "string" || data.user.name === null)
            ? data.user.name
            : null,
      };
    }
    if (typeof data.csrfToken === "string") {
      session.csrfToken = data.csrfToken;
    }
    if (typeof data._flash === "object" && data._flash !== null) {
      session._flash = Object.fromEntries(
        Object.entries(data._flash).filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) &&
            entry[1].every((message) => typeof message === "string"),
        ),
      );
    }
    return session;
  } catch {
    return {};
  }
};

const toStoredSession = (session: WebSession) => ({
  // Keep the legacy Redis session JSON shape so active browser sessions
  // survive the framework migration.
  cookie: {
    originalMaxAge: runtimeConfig.sessionTtlMs,
    expires: new Date(Date.now() + runtimeConfig.sessionTtlMs).toISOString(),
    secure: runtimeConfig.isProduction,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    priority: "high",
  },
  ...(session.user ? { user: session.user } : {}),
  ...(session.csrfToken ? { csrfToken: session.csrfToken } : {}),
  ...(session._flash ? { _flash: session._flash } : {}),
});

const runCallback = (
  callback: (error?: Error) => void,
  work: () => Promise<void>,
) => {
  void work().then(
    () => callback(),
    (error: unknown) =>
      callback(error instanceof Error ? error : new Error(String(error))),
  );
};

@Injectable()
export class WebSessionService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisProvider,
  ) {}

  async attach(request: FastifyRequest, reply: FastifyReply) {
    const redis = this.redis;
    const webRequest = request as FastifyRequest & { raw: WebIncomingMessage };
    const signedCookie = request.cookies[runtimeConfig.sessionCookieName];
    const signedValue = signedCookie?.startsWith("s:")
      ? signedCookie.slice(2)
      : undefined;
    const unsignedCookie = signedValue
      ? request.unsignCookie(signedValue)
      : undefined;
    let sessionId = unsignedCookie?.valid ? unsignedCookie.value : undefined;
    const data = parseSession(
      sessionId ? await redis.get(`${SESSION_PREFIX}${sessionId}`) : null,
    );
    const save = async () => {
      sessionId ??= randomUUID();
      await redis.set(
        `${SESSION_PREFIX}${sessionId}`,
        JSON.stringify(toStoredSession(session)),
        {
          expiration: { type: "EX", value: SESSION_TTL_SECONDS },
        },
      );
      reply.setCookie(
        runtimeConfig.sessionCookieName,
        `s:${reply.signCookie(sessionId)}`,
        {
          ...SESSION_COOKIE_OPTIONS,
        },
      );
    };

    const session: WebSession = {
      ...data,
      regenerate(callback) {
        runCallback(callback, async () => {
          if (sessionId) {
            await redis.del(`${SESSION_PREFIX}${sessionId}`);
          }
          sessionId = randomUUID();
          delete session.user;
          delete session.csrfToken;
          delete session._flash;
        });
      },
      save(callback) {
        runCallback(callback, save);
      },
      destroy(callback) {
        runCallback(callback, async () => {
          if (sessionId) {
            await redis.del(`${SESSION_PREFIX}${sessionId}`);
          }
          sessionId = undefined;
          reply.clearCookie(runtimeConfig.sessionCookieName, {
            path: SESSION_COOKIE_OPTIONS.path,
          });
        });
      },
    };

    const flash = ((type: string, message?: string) => {
      if (message !== undefined) {
        session._flash ??= {};
        session._flash[type] ??= [];
        session._flash[type].push(message);
        return session._flash[type].length;
      }
      const messages = session._flash?.[type] ?? [];
      if (session._flash) {
        delete session._flash[type];
        if (Object.keys(session._flash).length === 0) delete session._flash;
      }
      return messages;
    }) as WebFlash;

    webRequest.raw.session = session;
    webRequest.raw.flash = flash;
  }

  save(session: WebSession) {
    return new Promise<void>((resolve, reject) =>
      session.save((error) => (error ? reject(error) : resolve())),
    );
  }
}
