import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

type SetOptions = {
  NX?: boolean;
};

class InMemoryRedis {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  isOpen = true;

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options?: SetOptions) {
    if (options?.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async getDel(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }

  async exists(key: string) {
    return this.values.has(key) ? 1 : 0;
  }

  async del(keyOrKeys: string | string[]) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) deleted += 1;
      if (this.sets.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async unlink(keyOrKeys: string | string[]) {
    return this.del(keyOrKeys);
  }

  async mGet(keys: string[]) {
    return keys.map((key) => this.values.get(key) ?? null);
  }

  async incr(key: string) {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async sAdd(key: string, member: string) {
    const members = this.sets.get(key) ?? new Set<string>();
    const sizeBefore = members.size;
    members.add(member);
    this.sets.set(key, members);
    return members.size - sizeBefore;
  }

  async sMembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }

  async expire(key: string, ttl: number) {
    void key;
    void ttl;
    return true;
  }

  multi() {
    const operations: Array<() => Promise<unknown>> = [];
    const chain = {
      set: (key: string, value: string, options?: SetOptions) => {
        operations.push(() => this.set(key, value, options));
        return chain;
      },
      sAdd: (key: string, member: string) => {
        operations.push(() => this.sAdd(key, member));
        return chain;
      },
      expire: (key: string, ttl: number) => {
        operations.push(() => this.expire(key, ttl));
        return chain;
      },
      exec: async () => Promise.all(operations.map((operation) => operation())),
    };
    return chain;
  }

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ) {
    const [key] = options.keys;
    const [expectedValue] = options.arguments;
    if (key && this.values.get(key) === expectedValue) {
      this.values.delete(key);
      return 1;
    }
    return 0;
  }

  async publish() {
    return 0;
  }

  async subscribe() {
    return undefined;
  }

  async scan() {
    return { cursor: "0", keys: [] as string[] };
  }

  async *scanIterator() {
    for (const key of [] as string[]) yield key;
  }

  async close() {
    this.isOpen = false;
  }

  clear() {
    this.values.clear();
    this.sets.clear();
  }
}

const replaceMethod = (
  context: { after: (cleanup: () => void) => void },
  target: Record<string, unknown>,
  methodName: string,
  replacement: CallableFunction,
) => {
  const original = target[methodName];
  target[methodName] = replacement;
  context.after(() => {
    target[methodName] = original;
  });
};

test("auth, cache, and study-session integration", async (suite) => {
  process.env.JWT_SECRET = "integration-access-secret-at-least-32-chars";
  process.env.JWT_REFRESH_SECRET =
    "integration-refresh-secret-at-least-32-chars";
  process.env.JWT_EXPIRE = "15m";
  process.env.JWT_REFRESH_EXPIRE = "7d";

  const { redisClient, pubSubRedis } = await import("../../src/utils/redis");
  const redis = new InMemoryRedis();
  redisClient.client = redis as never;
  pubSubRedis.pubClient = redis as never;
  pubSubRedis.subClient = redis as never;

  const { prisma } = await import("../../src/libs/prisma");
  const { hashPassword } = await import("../../src/utils/hash");
  const { apiAuthService } = await import("../../src/services/apiAuth.service");
  const { postsService } = await import("../../src/services/posts.service");
  const { StudyService } = await import("../../src/services/study.service");
  const { getStudySessionDocumentId } =
    await import("../../src/repositories/user-progress.repository");

  await suite.test(
    "auth rotates a refresh token only once and authenticates its access token",
    async (t) => {
      redis.clear();
      const password = "integration-password";
      const user = {
        id: "64b000000000000000000001",
        email: "auth-integration@example.com",
        name: "Auth Integration",
        password: await hashPassword(password),
        status: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      replaceMethod(
        t,
        prisma.user as unknown as Record<string, unknown>,
        "findUnique",
        async () => user,
      );

      const tokens = await apiAuthService.login({
        email: user.email,
        password,
      });
      assert.notEqual(tokens, false);
      if (!tokens) return;

      const profile = await apiAuthService.getProfile(tokens.accessToken);
      assert.deepEqual(profile, {
        id: user.id,
        email: user.email,
        name: user.name,
        status: true,
      });

      const rotations = await Promise.all([
        apiAuthService.refreshToken(tokens.refreshToken),
        apiAuthService.refreshToken(tokens.refreshToken),
      ]);
      assert.equal(rotations.filter(Boolean).length, 1);
      assert.equal(rotations.filter((result) => result === false).length, 1);

      await apiAuthService.logout(tokens.accessToken, user.id);
      assert.equal(await apiAuthService.getProfile(tokens.accessToken), false);
    },
  );

  await suite.test(
    "post cache keeps user-specific query results isolated",
    async (t) => {
      redis.clear();
      let databaseQueries = 0;
      replaceMethod(
        t,
        prisma.post as unknown as Record<string, unknown>,
        "findMany",
        async (query: { where: { user: { id: string } } }) => {
          databaseQueries += 1;
          const userId = query.where.user.id;
          return [
            {
              id: `post-${userId}`,
              title: `Post for ${userId}`,
              content: "integration-test",
              userId,
            },
          ];
        },
      );

      const requestFor = (userId: string) =>
        ({ user: { id: userId } }) as unknown as Request;
      const postsA = await postsService.getPost(requestFor("user-a"));
      const postsB = await postsService.getPost(requestFor("user-b"));
      const postsAFromCache = await postsService.getPost(requestFor("user-a"));

      assert.equal(postsA[0]?.userId, "user-a");
      assert.equal(postsB[0]?.userId, "user-b");
      assert.deepEqual(postsAFromCache, postsA);
      assert.equal(databaseQueries, 2);
    },
  );

  await suite.test(
    "syncProgress returns the same StudySession when the client retries",
    async (t) => {
      redis.clear();
      const persistedSessions = new Map<string, Record<string, unknown>>();
      let transactions = 0;
      let progressWrites = 0;

      replaceMethod(
        t,
        prisma.studySession as unknown as Record<string, unknown>,
        "findUnique",
        async (query: { where: { id: string } }) =>
          persistedSessions.get(query.where.id) ?? null,
      );
      replaceMethod(
        t,
        prisma as unknown as Record<string, unknown>,
        "$transaction",
        async (callback: (transaction: unknown) => Promise<unknown>) => {
          transactions += 1;
          const transaction = {
            studySession: {
              upsert: async (query: {
                where: { id: string };
                create: Record<string, unknown>;
              }) => {
                const existing = persistedSessions.get(query.where.id);
                if (existing) return existing;
                const created = {
                  ...query.create,
                  createdAt: new Date(),
                };
                persistedSessions.set(query.where.id, created);
                return created;
              },
            },
            $runCommandRaw: async () => {
              progressWrites += 1;
              return { ok: 1 };
            },
          };
          return callback(transaction);
        },
      );

      const userId = "64b000000000000000000002";
      const setId = "64b000000000000000000003";
      const cardId = "64b000000000000000000004";
      const clientSessionId = "sess-integration-idempotency";
      const sessionKey = `user:${userId}:session:${clientSessionId}`;
      const now = new Date().toISOString();
      const serializedSession = JSON.stringify({
        sessionId: clientSessionId,
        userId,
        setId,
        mode: "QUIZ",
        totalCards: 1,
        correctCount: 1,
        wrongCount: 0,
        cardProgressMap: {
          [cardId]: {
            cardId,
            streak: 1,
            correctCount: 1,
            wrongCount: 0,
            status: "LEARNING",
            nextReviewAt: now,
            lastReviewedAt: now,
          },
        },
      });
      redis.values.set(sessionKey, serializedSession);

      const service = new StudyService();
      const first = await service.syncProgress(userId, clientSessionId);

      // Simulate a process crash after MongoDB commit but before Redis cleanup.
      redis.values.set(sessionKey, serializedSession);
      const retry = await service.syncProgress(userId, clientSessionId);
      const expectedDocumentId = getStudySessionDocumentId(
        userId,
        clientSessionId,
      );

      assert.equal(first.id, expectedDocumentId);
      assert.equal(retry.id, expectedDocumentId);
      assert.notEqual(
        expectedDocumentId,
        getStudySessionDocumentId("64b000000000000000000099", clientSessionId),
      );
      assert.equal(persistedSessions.size, 1);
      assert.equal(transactions, 1);
      assert.equal(progressWrites, 1);
      assert.equal(await redis.get(sessionKey), null);
    },
  );
});
