import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import test from "node:test";
import { createClient, type RedisClientType } from "redis";
import { PrismaClient } from "../../src/generated/prisma/client";

const BACKEND_DIRECTORY = resolve(__dirname, "../..");
const FRONTEND_DIRECTORY = resolve(BACKEND_DIRECTORY, "../Frontend");
const COMPOSE_FILE = join(__dirname, "docker-compose.yml");
const COMPOSE_PROJECT = "english-learning-product-test";
const MONGO_URL =
  "mongodb://root:product-test-password@127.0.0.1:37017/english_learning_product_test?authSource=admin&replicaSet=rs0&directConnection=true";
const REDIS_URL = "redis://127.0.0.1:36379";
const ELASTICSEARCH_URL = "http://127.0.0.1:39200";
const NODE_1_URL = "http://127.0.0.1:3301";
const NODE_2_URL = "http://127.0.0.1:3302";
const NGINX_URL = "http://127.0.0.1:38080";
const LATENCY_PROXY_URL = "http://127.0.0.1:38081";
const FRONTEND_URL = "http://127.0.0.1:34173";

const wait = (milliseconds: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const positiveIntegerFromEnv = (
  value: string | undefined,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const percentile = (sortedValues: number[], percentage: number) => {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * percentage) - 1,
  );
  return sortedValues[Math.max(index, 0)] ?? 0;
};

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  allowFailure?: boolean;
};

const runCommand = (
  executable: string,
  arguments_: string[],
  options: CommandOptions = {},
) =>
  new Promise<string>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 100_000) output = output.slice(-100_000);
    };
    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `${executable} ${arguments_.join(" ")} timed out after ${options.timeoutMs ?? 300_000}ms\n${output}`,
        ),
      );
    }, options.timeoutMs ?? 300_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0 || options.allowFailure) resolvePromise(output);
      else {
        reject(
          new Error(
            `${executable} ${arguments_.join(" ")} exited with ${code}\n${output}`,
          ),
        );
      }
    });
  });

class ManagedProcess {
  private output = "";
  readonly child: ChildProcess;

  constructor(
    readonly name: string,
    executable: string,
    arguments_: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv },
  ) {
    this.child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const appendOutput = (chunk: Buffer) => {
      this.output += chunk.toString();
      if (this.output.length > 100_000) {
        this.output = this.output.slice(-100_000);
      }
    };
    this.child.stdout?.on("data", appendOutput);
    this.child.stderr?.on("data", appendOutput);
  }

  get logs() {
    return this.output;
  }

  get running() {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  async stop() {
    if (!this.running) return;
    this.child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolvePromise) =>
        this.child.once("exit", () => resolvePromise()),
      ),
      wait(8_000).then(() => {
        if (this.running) this.child.kill("SIGKILL");
      }),
    ]);
  }
}

const waitForTcpPort = async (port: number, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolvePromise) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const finish = (result: boolean) => {
        socket.destroy();
        resolvePromise(result);
      };
      socket.setTimeout(500);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
    if (connected) return;
    await wait(250);
  }
  throw new Error(`Port ${port} was not ready after ${timeoutMs}ms`);
};

const waitForHttp = async (
  url: string,
  timeoutMs = 120_000,
  processToWatch?: ManagedProcess,
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (processToWatch && !processToWatch.running) {
      throw new Error(
        `${processToWatch.name} exited before ${url} was ready\n${processToWatch.logs}`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }
  throw new Error(
    `${url} was not ready after ${timeoutMs}ms: ${String(lastError)}${
      processToWatch ? `\n${processToWatch.logs}` : ""
    }`,
  );
};

const retry = async <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await wait(300);
    }
  }
  throw new Error(`${label} did not succeed: ${String(lastError)}`);
};

class TcpLatencyProxy {
  private readonly sockets = new Set<Socket>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private server: Server | null = null;

  constructor(
    private readonly listenPort: number,
    private readonly upstreamPort: number,
    private readonly oneWayDelayMs: number,
  ) {}

  async start() {
    this.server = createServer((client) => {
      const upstream = createConnection({
        host: "127.0.0.1",
        port: this.upstreamPort,
      });
      this.sockets.add(client);
      this.sockets.add(upstream);

      const relay = (destination: Socket, chunk: Buffer) => {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (!destination.destroyed) destination.write(chunk);
        }, this.oneWayDelayMs);
        this.timers.add(timer);
      };

      client.on("data", (chunk: Buffer) => relay(upstream, chunk));
      upstream.on("data", (chunk: Buffer) => relay(client, chunk));
      client.once("end", () => upstream.end());
      upstream.once("end", () => client.end());
      client.once("error", () => upstream.destroy());
      upstream.once("error", () => client.destroy());
      client.once("close", () => this.sockets.delete(client));
      upstream.once("close", () => this.sockets.delete(upstream));
    });

    await new Promise<void>((resolvePromise, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.listenPort, "127.0.0.1", () => resolvePromise());
    });
  }

  async stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!this.server) return;
    await new Promise<void>((resolvePromise) =>
      this.server?.close(() => resolvePromise()),
    );
    this.server = null;
  }
}

type JsonResponse = {
  response: Response;
  body: unknown;
};

const jsonRequest = async (
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<JsonResponse> => {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  const requestInit: RequestInit = {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (options.body !== undefined)
    requestInit.body = JSON.stringify(options.body);
  const response = await fetch(`${baseUrl}${path}`, requestInit);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, body };
};

const apiData = <T>(result: JsonResponse): T => {
  const body = result.body as { obj?: { data?: T } };
  assert.ok(body.obj && "data" in body.obj, JSON.stringify(result.body));
  return body.obj.data as T;
};

const runHttpLoad = async (
  total: number,
  concurrency: number,
  operation: () => Promise<void>,
) => {
  let nextIndex = 0;
  const latencies: number[] = [];
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;
        const requestStartedAt = performance.now();
        await operation();
        latencies.push(performance.now() - requestStartedAt);
      }
    }),
  );
  const durationMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    total,
    concurrency,
    durationMs,
    requestsPerSecond: total / (durationMs / 1_000),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
  };
};

class ProductStack {
  readonly backends: ManagedProcess[] = [];
  private frontend: ManagedProcess | null = null;
  private latencyProxy: TcpLatencyProxy | null = null;
  redis: RedisClientType | null = null;
  prisma: PrismaClient | null = null;

  private get composeArguments() {
    return ["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE];
  }

  async start() {
    assert.ok(
      existsSync(join(BACKEND_DIRECTORY, "dist/src/app.js")),
      "Run npm run build before the product test",
    );

    await runCommand(
      "docker",
      [...this.composeArguments, "down", "--volumes", "--remove-orphans"],
      { cwd: BACKEND_DIRECTORY, allowFailure: true, timeoutMs: 60_000 },
    );
    await runCommand(
      "docker",
      [
        ...this.composeArguments,
        "up",
        "-d",
        "mongo-key-init",
        "mongo",
        "mongo-replica-init",
        "redis",
        "elasticsearch",
      ],
      { cwd: BACKEND_DIRECTORY, timeoutMs: 480_000 },
    );

    await waitForTcpPort(36379);
    await waitForHttp(
      `${ELASTICSEARCH_URL}/_cluster/health?wait_for_status=yellow`,
      180_000,
    );

    const prismaExecutable = join(
      BACKEND_DIRECTORY,
      "node_modules/.bin/prisma",
    );
    await retry(
      () =>
        runCommand(prismaExecutable, ["db", "push", "--skip-generate"], {
          cwd: BACKEND_DIRECTORY,
          env: { ...process.env, DATABASE_URL: MONGO_URL },
          timeoutMs: 60_000,
        }),
      90_000,
      "MongoDB schema initialization",
    );

    const sharedEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: MONGO_URL,
      REDIS_URL,
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "36379",
      REDIS_CONNECT_TIMEOUT_MS: "5000",
      REDIS_COMMAND_TIMEOUT_MS: "5000",
      ELASTICSEARCH_URL,
      ELASTICSEARCH_DECK_INDEX: "public_flashcard_decks_product_test",
      ELASTICSEARCH_FALLBACK_TO_MONGO: "false",
      JWT_SECRET: "product-test-access-secret-at-least-32-characters",
      JWT_REFRESH_SECRET: "product-test-refresh-secret-at-least-32-characters",
      JWT_EXPIRE: "15m",
      JWT_REFRESH_EXPIRE: "7d",
      SESSION_SECRET: "product-test-session-secret-at-least-32-characters",
      ENABLE_EMAIL_SCHEDULER: "false",
      CORS_ALLOWED_ORIGINS: FRONTEND_URL,
      FRONTEND_URL,
      TRUST_PROXY: "1",
      RATE_LIMIT_MAX_REQUESTS: "100000",
      RATE_LIMIT_BUCKET_CAPACITY: "100000",
      RATE_LIMIT_WINDOW_MS: "60000",
      AUTH_RATE_LIMIT_MAX_REQUESTS: "1000",
      AUTH_RATE_LIMIT_WINDOW_MS: "60000",
      HEAVY_RATE_LIMIT_MAX_REQUESTS: "10",
      HEAVY_RATE_LIMIT_WINDOW_MS: "60000",
    };

    for (const [index, port] of [3301, 3302].entries()) {
      const backend = new ManagedProcess(
        `backend-${index + 1}`,
        process.execPath,
        ["dist/src/app.js"],
        {
          cwd: BACKEND_DIRECTORY,
          env: {
            ...sharedEnvironment,
            PORT: String(port),
            WEBSOCKET_PORT: String(38301 + index),
          },
        },
      );
      this.backends.push(backend);
    }

    await Promise.all([
      waitForHttp(`${NODE_1_URL}/api/v1/sets`, 90_000, this.backends[0]),
      waitForHttp(`${NODE_2_URL}/api/v1/sets`, 90_000, this.backends[1]),
    ]);

    this.frontend = new ManagedProcess(
      "frontend-preview",
      join(FRONTEND_DIRECTORY, "node_modules/.bin/vite"),
      ["preview", "--host", "127.0.0.1", "--port", "34173", "--strictPort"],
      { cwd: FRONTEND_DIRECTORY },
    );
    await waitForHttp(FRONTEND_URL, 60_000, this.frontend);

    await runCommand(
      "docker",
      [...this.composeArguments, "--profile", "proxy", "up", "-d", "nginx"],
      { cwd: BACKEND_DIRECTORY, timeoutMs: 120_000 },
    );
    await waitForHttp(`${NGINX_URL}/api/v1/sets`, 60_000);

    this.latencyProxy = new TcpLatencyProxy(38081, 38080, 60);
    await this.latencyProxy.start();

    this.redis = createClient({ url: REDIS_URL });
    await this.redis.connect();
    process.env.DATABASE_URL = MONGO_URL;
    this.prisma = new PrismaClient();
    await this.prisma.$connect();
  }

  async stop() {
    const cleanupErrors: unknown[] = [];
    const safely = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    if (this.latencyProxy) await safely(() => this.latencyProxy!.stop());
    if (this.redis?.isOpen) await safely(() => this.redis!.close());
    if (this.prisma) await safely(() => this.prisma!.$disconnect());
    await Promise.all(
      this.backends.map((backend) => safely(() => backend.stop())),
    );
    if (this.frontend) await safely(() => this.frontend!.stop());
    await safely(() =>
      runCommand(
        "docker",
        [...this.composeArguments, "down", "--volumes", "--remove-orphans"],
        { cwd: BACKEND_DIRECTORY, allowFailure: true, timeoutMs: 60_000 },
      ),
    );

    if (cleanupErrors.length > 0) {
      console.warn("Product test cleanup warnings", cleanupErrors);
    }
  }
}

type User = {
  id: string;
  email: string;
  name: string | null;
};

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

type Card = {
  id: string;
  term: string;
  definition: string;
  audioUrl: string | null;
  exampleSentence: string | null;
  imageUrl: string | null;
};

type Deck = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  cards: Card[];
};

test(
  "production-like product stack",
  { timeout: 12 * 60_000 },
  async (suite) => {
    const stack = new ProductStack();
    const suffix = `${Date.now()}-${process.pid}`;
    let userA: User;
    let userB: User;
    let tokensA: Tokens;
    let tokensB: Tokens;
    let privateDeck: Deck;
    let publicDeck: Deck;

    try {
      await stack.start();

      await suite.test("serves the production frontend build", async () => {
        const root = await fetch(FRONTEND_URL);
        assert.equal(root.status, 200);
        const html = await root.text();
        assert.match(html, /<div id="root"><\/div>/);
        const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
        assert.ok(
          assetPath,
          "built index.html must reference a JavaScript asset",
        );
        const asset = await fetch(new URL(assetPath, FRONTEND_URL));
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get("content-type") ?? "", /javascript/);

        const spaRoute = await fetch(`${FRONTEND_URL}/sets/example`);
        assert.equal(spaRoute.status, 200);
        assert.match(await spaRoute.text(), /<div id="root"><\/div>/);
      });

      await suite.test(
        "runs auth over HTTP and rotates one refresh token atomically across instances",
        async () => {
          const password = "product-test-password";
          const registerA = await jsonRequest(
            NODE_1_URL,
            "/api/v1/auth/register",
            {
              body: {
                name: "Product User A",
                email: `product-a-${suffix}@example.com`,
                password,
              },
            },
          );
          const registerB = await jsonRequest(
            NODE_2_URL,
            "/api/v1/auth/register",
            {
              body: {
                name: "Product User B",
                email: `product-b-${suffix}@example.com`,
                password,
              },
            },
          );
          assert.equal(
            registerA.response.status,
            201,
            JSON.stringify(registerA.body),
          );
          assert.equal(
            registerB.response.status,
            201,
            JSON.stringify(registerB.body),
          );
          userA = apiData<User>(registerA);
          userB = apiData<User>(registerB);

          const loginA = await jsonRequest(NODE_1_URL, "/api/v1/auth/login", {
            body: { email: userA.email, password },
          });
          const loginB = await jsonRequest(NODE_2_URL, "/api/v1/auth/login", {
            body: { email: userB.email, password },
          });
          assert.equal(
            loginA.response.status,
            200,
            JSON.stringify(loginA.body),
          );
          assert.equal(
            loginB.response.status,
            200,
            JSON.stringify(loginB.body),
          );
          tokensA = apiData<Tokens>(loginA);
          tokensB = apiData<Tokens>(loginB);

          const profileAcrossInstances = await jsonRequest(
            NODE_2_URL,
            "/api/v1/auth/me",
            { token: tokensA.accessToken },
          );
          assert.equal(profileAcrossInstances.response.status, 200);
          assert.equal(apiData<User>(profileAcrossInstances).id, userA.id);

          const rotations = await Promise.all(
            Array.from({ length: 12 }, () =>
              jsonRequest(NGINX_URL, "/api/v1/auth/refresh-token", {
                body: { refreshToken: tokensA.refreshToken },
              }),
            ),
          );
          const successfulRotations = rotations.filter(
            ({ response }) => response.status === 200,
          );
          assert.equal(successfulRotations.length, 1);
          assert.equal(
            rotations.filter(({ response }) => response.status === 401).length,
            11,
            JSON.stringify(
              rotations.map(({ response, body }) => ({
                status: response.status,
                body,
                upstream: response.headers.get("x-test-upstream"),
                upstreamStatus: response.headers.get("x-test-upstream-status"),
              })),
            ),
          );
          tokensA = apiData<Tokens>(successfulRotations[0] as JsonResponse);
        },
      );

      await suite.test(
        "rejects a revoked token across both warm Node L1 caches",
        async () => {
          const login = await jsonRequest(NODE_1_URL, "/api/v1/auth/login", {
            body: {
              email: userA.email,
              password: "product-test-password",
            },
          });
          assert.equal(login.response.status, 200, JSON.stringify(login.body));
          const disposableTokens = apiData<Tokens>(login);

          const primedProfiles = await Promise.all(
            [NODE_1_URL, NODE_2_URL].map((baseUrl) =>
              jsonRequest(baseUrl, "/api/v1/auth/me", {
                token: disposableTokens.accessToken,
              }),
            ),
          );
          assert.ok(
            primedProfiles.every(({ response }) => response.status === 200),
          );

          const logout = await jsonRequest(NGINX_URL, "/api/v1/auth/logout", {
            method: "DELETE",
            token: disposableTokens.accessToken,
          });
          assert.equal(logout.response.status, 200, JSON.stringify(logout.body));

          const rejectedProfiles = await Promise.all(
            [NODE_1_URL, NODE_2_URL].map((baseUrl) =>
              jsonRequest(baseUrl, "/api/v1/auth/me", {
                token: disposableTokens.accessToken,
              }),
            ),
          );
          assert.ok(
            rejectedProfiles.every(({ response }) => response.status === 401),
            JSON.stringify(
              rejectedProfiles.map(({ response, body }) => ({
                status: response.status,
                body,
              })),
            ),
          );
        },
      );

      await suite.test(
        "enforces validation, CORS, ownership, and private-deck cache isolation",
        async () => {
          const invalidSet = await jsonRequest(NGINX_URL, "/api/v1/sets", {
            token: tokensA.accessToken,
            body: { title: "", cards: [] },
          });
          assert.equal(invalidSet.response.status, 400);

          const rejectedOrigin = await jsonRequest(NGINX_URL, "/api/v1/sets", {
            headers: { Origin: "https://attacker.example" },
          });
          assert.equal(rejectedOrigin.response.status, 403);

          const created = await jsonRequest(NODE_1_URL, "/api/v1/sets", {
            token: tokensA.accessToken,
            body: {
              title: `Private product deck ${suffix}`,
              description: "private cache-isolation test",
              isPublic: false,
              cards: [
                { term: "alpha", definition: "first" },
                { term: "bravo", definition: "second" },
                { term: "charlie", definition: "third" },
                { term: "delta", definition: "fourth" },
              ],
            },
          });
          assert.equal(
            created.response.status,
            201,
            JSON.stringify(created.body),
          );
          privateDeck = apiData<Deck>(created);

          const ownerPrimeOnNode2 = await jsonRequest(
            NODE_2_URL,
            `/api/v1/sets/${privateDeck.id}`,
            { token: tokensA.accessToken },
          );
          assert.equal(ownerPrimeOnNode2.response.status, 200);

          const otherUserRead = await jsonRequest(
            NGINX_URL,
            `/api/v1/sets/${privateDeck.id}`,
            { token: tokensB.accessToken },
          );
          assert.equal(otherUserRead.response.status, 404);

          const otherUserList = await jsonRequest(NGINX_URL, "/api/v1/sets", {
            token: tokensB.accessToken,
          });
          assert.equal(otherUserList.response.status, 200);
          const visibleToB = apiData<Array<{ id: string }>>(otherUserList);
          assert.equal(
            visibleToB.some(({ id }) => id === privateDeck.id),
            false,
          );

          const updatedTitle = `Private deck updated ${suffix}`;
          const updated = await jsonRequest(
            NODE_1_URL,
            `/api/v1/sets/${privateDeck.id}`,
            {
              method: "PUT",
              token: tokensA.accessToken,
              body: {
                title: updatedTitle,
                description: privateDeck.description ?? undefined,
                isPublic: false,
                cards: privateDeck.cards.map((card) => ({
                  id: card.id,
                  term: card.term,
                  definition: card.definition,
                  audioUrl: card.audioUrl ?? "",
                  exampleSentence: card.exampleSentence ?? undefined,
                  imageUrl: card.imageUrl ?? "",
                })),
              },
            },
          );
          assert.equal(
            updated.response.status,
            200,
            JSON.stringify(updated.body),
          );
          privateDeck = apiData<Deck>(updated);

          await retry(
            async () => {
              const fromOtherNode = await jsonRequest(
                NODE_2_URL,
                `/api/v1/sets/${privateDeck.id}`,
                { token: tokensA.accessToken },
              );
              assert.equal(fromOtherNode.response.status, 200);
              assert.equal(apiData<Deck>(fromOtherNode).title, updatedTitle);
            },
            5_000,
            "cross-instance L1 invalidation",
          );
        },
      );

      await suite.test(
        "indexes and searches public decks through Elasticsearch",
        async () => {
          const searchTerm = `searchable-${suffix}`;
          const created = await jsonRequest(NODE_2_URL, "/api/v1/sets", {
            token: tokensB.accessToken,
            body: {
              title: `${searchTerm} vocabulary`,
              description: "Elasticsearch product test",
              isPublic: true,
              cards: [
                { term: "one", definition: "một" },
                { term: "two", definition: "hai" },
                { term: "three", definition: "ba" },
                { term: "four", definition: "bốn" },
              ],
            },
          });
          assert.equal(
            created.response.status,
            201,
            JSON.stringify(created.body),
          );
          publicDeck = apiData<Deck>(created);

          await retry(
            async () => {
              const result = await jsonRequest(
                NGINX_URL,
                `/api/decks/public/search?q=${encodeURIComponent(searchTerm)}&page=1&limit=10`,
              );
              assert.equal(
                result.response.status,
                200,
                JSON.stringify(result.body),
              );
              const data = apiData<{ decks: Array<{ id: string }> }>(result);
              assert.ok(data.decks.some(({ id }) => id === publicDeck.id));
            },
            15_000,
            "Elasticsearch refresh",
          );
        },
      );

      await suite.test(
        "preserves concurrent study updates and syncs idempotently to MongoDB",
        async () => {
          assert.ok(stack.redis);
          assert.ok(stack.prisma);
          const sessionId = `product-session-${randomUUID()}`;
          const correctness = [true, false, true, true];
          const submissions = await Promise.all(
            privateDeck.cards.map((card, index) =>
              jsonRequest(
                index % 2 === 0 ? NODE_1_URL : NODE_2_URL,
                "/api/v1/study/submit-answer",
                {
                  token: tokensA.accessToken,
                  body: {
                    sessionId,
                    setId: privateDeck.id,
                    mode: "QUIZ",
                    cardId: card.id,
                    isCorrect: correctness[index],
                  },
                },
              ),
            ),
          );
          assert.ok(
            submissions.every(({ response }) => response.status === 200),
            JSON.stringify(
              submissions.map(({ response, body }) => ({
                status: response.status,
                body,
              })),
            ),
          );

          const sessionKey = `user:${userA.id}:session:${sessionId}`;
          const rawSession = await stack.redis.get(sessionKey);
          assert.ok(rawSession);
          const sessionState = JSON.parse(rawSession) as {
            correctCount: number;
            wrongCount: number;
            cardProgressMap: Record<string, unknown>;
          };
          assert.equal(sessionState.correctCount, 3);
          assert.equal(sessionState.wrongCount, 1);
          assert.equal(Object.keys(sessionState.cardProgressMap).length, 4);

          const syncResults = await Promise.all(
            [NODE_1_URL, NODE_2_URL, NGINX_URL].map((baseUrl) =>
              jsonRequest(baseUrl, "/api/v1/study/sync-progress", {
                token: tokensA.accessToken,
                body: { sessionId },
              }),
            ),
          );
          assert.ok(
            syncResults.every(({ response }) => response.status === 200),
            JSON.stringify(
              syncResults.map(({ response, body }) => ({
                status: response.status,
                body,
              })),
            ),
          );
          const sessionIds = syncResults.map(
            (result) => apiData<{ id: string }>(result).id,
          );
          assert.equal(new Set(sessionIds).size, 1);
          const persistedSessionId = sessionIds[0];
          assert.ok(persistedSessionId);

          const retrySync = await jsonRequest(
            NODE_2_URL,
            "/api/v1/study/sync-progress",
            { token: tokensA.accessToken, body: { sessionId } },
          );
          assert.equal(retrySync.response.status, 200);
          assert.equal(
            apiData<{ id: string }>(retrySync).id,
            persistedSessionId,
          );

          assert.equal(
            await stack.prisma.studySession.count({
              where: { id: persistedSessionId },
            }),
            1,
          );
          assert.equal(
            await stack.prisma.userCardProgress.count({
              where: {
                userId: userA.id,
                cardId: { in: privateDeck.cards.map(({ id }) => id) },
              },
            }),
            4,
          );
        },
      );

      await suite.test(
        "shares rate-limit state across both Node instances",
        async () => {
          assert.ok(stack.redis);
          await stack.redis.del(`rateLimit:heavy:user:${userB.id}`);
          const responses = await Promise.all(
            Array.from({ length: 20 }, () =>
              jsonRequest(
                NGINX_URL,
                `/api/v1/sets/${publicDeck.id}/quiz?limit=1`,
                { method: "POST", token: tokensB.accessToken },
              ),
            ),
          );
          const allowed = responses.filter(
            ({ response }) => response.status === 200,
          ).length;
          const limited = responses.filter(
            ({ response }) => response.status === 429,
          ).length;
          assert.ok(allowed >= 10 && allowed <= 11, `allowed=${allowed}`);
          assert.equal(
            allowed + limited,
            20,
            JSON.stringify(
              responses.map(({ response, body }) => ({
                status: response.status,
                body,
                upstream: response.headers.get("x-test-upstream"),
              })),
            ),
          );
          assert.ok(limited >= 9, `limited=${limited}`);
        },
      );

      await suite.test(
        "balances requests over both Node instances",
        async () => {
          const responses = await Promise.all(
            Array.from({ length: 40 }, () =>
              jsonRequest(NGINX_URL, "/api/v1/sets", {
                token: tokensA.accessToken,
              }),
            ),
          );
          assert.ok(
            responses.every(({ response }) => response.status === 200),
            JSON.stringify(
              responses.map(({ response, body }) => ({
                status: response.status,
                body,
                upstream: response.headers.get("x-test-upstream"),
              })),
            ),
          );
          const upstreams = responses.map(
            ({ response }) => response.headers.get("x-test-upstream") ?? "",
          );
          assert.ok(upstreams.some((value) => value.includes(":3301")));
          assert.ok(upstreams.some((value) => value.includes(":3302")));
        },
      );

      await suite.test(
        "measures the complete HTTP path under load",
        async (t) => {
          const total = positiveIntegerFromEnv(
            process.env.PRODUCT_HTTP_REQUESTS,
            1_000,
          );
          const concurrency = positiveIntegerFromEnv(
            process.env.PRODUCT_HTTP_CONCURRENCY,
            50,
          );
          const minimumRps = positiveIntegerFromEnv(
            process.env.PRODUCT_HTTP_MIN_RPS,
            50,
          );
          const maximumP99Ms = positiveIntegerFromEnv(
            process.env.PRODUCT_HTTP_MAX_P99_MS,
            2_000,
          );
          const metrics = await runHttpLoad(total, concurrency, async () => {
            const result = await jsonRequest(NGINX_URL, "/api/v1/sets", {
              token: tokensA.accessToken,
            });
            assert.equal(result.response.status, 200);
          });
          t.diagnostic(
            JSON.stringify({ workload: "NGINX_HTTP_GET_SETS", ...metrics }),
          );
          assert.ok(metrics.requestsPerSecond >= minimumRps);
          assert.ok(metrics.p99Ms <= maximumP99Ms);
        },
      );

      await suite.test(
        "measures benchmark breakdown: direct vs nginx, auth vs anon, warm vs cold",
        async (t) => {
          const benchmarkRequests = positiveIntegerFromEnv(
            process.env.PRODUCT_BENCHMARK_REQUESTS,
            100,
          );
          const benchmarkConcurrency = positiveIntegerFromEnv(
            process.env.PRODUCT_BENCHMARK_CONCURRENCY,
            10,
          );

          // Warm up cache for both authenticated and anonymous endpoints
          await jsonRequest(NODE_1_URL, "/api/v1/sets", {
            token: tokensA.accessToken,
          });
          await jsonRequest(NODE_1_URL, "/api/v1/sets");

          // 1. Direct Node.js vs Nginx (Authenticated, Warm Cache)
          const directNodeWarmAuth = await runHttpLoad(
            benchmarkRequests,
            benchmarkConcurrency,
            async () => {
              const res = await jsonRequest(NODE_1_URL, "/api/v1/sets", {
                token: tokensA.accessToken,
              });
              assert.equal(res.response.status, 200);
            },
          );
          t.diagnostic(
            JSON.stringify({
              workload: "BENCHMARK_DIRECT_NODE_WARM_AUTH",
              ...directNodeWarmAuth,
            }),
          );

          const nginxWarmAuth = await runHttpLoad(
            benchmarkRequests,
            benchmarkConcurrency,
            async () => {
              const res = await jsonRequest(NGINX_URL, "/api/v1/sets", {
                token: tokensA.accessToken,
              });
              assert.equal(res.response.status, 200);
            },
          );
          t.diagnostic(
            JSON.stringify({
              workload: "BENCHMARK_NGINX_WARM_AUTH",
              ...nginxWarmAuth,
            }),
          );

          // 2. Authenticated vs Anonymous (Nginx, Warm Cache)
          const nginxWarmAnon = await runHttpLoad(
            benchmarkRequests,
            benchmarkConcurrency,
            async () => {
              const res = await jsonRequest(NGINX_URL, "/api/v1/sets");
              assert.equal(res.response.status, 200);
            },
          );
          t.diagnostic(
            JSON.stringify({
              workload: "BENCHMARK_NGINX_WARM_ANON",
              ...nginxWarmAnon,
            }),
          );

          // 3. Cache Cold vs Cache Warm (Direct Node Authenticated)
          // Repeatedly evict the cache key to force MongoDB query on each sample
          const coldSamples = 15;
          const coldLatencies: number[] = [];
          const userCacheKey = `sets:list:summary:v1:user:${userA.id}`;
          for (let index = 0; index < coldSamples; index += 1) {
            await stack.redis?.del(userCacheKey);
            const start = performance.now();
            const res = await jsonRequest(NODE_1_URL, "/api/v1/sets", {
              token: tokensA.accessToken,
            });
            coldLatencies.push(performance.now() - start);
            assert.equal(res.response.status, 200);
          }
          coldLatencies.sort((left, right) => left - right);
          const directNodeColdAuth = {
            total: coldSamples,
            concurrency: 1,
            p50Ms: percentile(coldLatencies, 0.5),
            p95Ms: percentile(coldLatencies, 0.95),
            p99Ms: percentile(coldLatencies, 0.99),
          };
          t.diagnostic(
            JSON.stringify({
              workload: "BENCHMARK_DIRECT_NODE_COLD_AUTH",
              ...directNodeColdAuth,
            }),
          );

          // Summary Comparison
          t.diagnostic(
            JSON.stringify({
              workload: "BENCHMARK_BREAKDOWN_SUMMARY",
              directNodeWarmAuthP50: directNodeWarmAuth.p50Ms,
              nginxWarmAuthP50: nginxWarmAuth.p50Ms,
              nginxWarmAnonP50: nginxWarmAnon.p50Ms,
              directNodeColdAuthP50: directNodeColdAuth.p50Ms,
              nginxOverheadP50: Math.max(
                0,
                nginxWarmAuth.p50Ms - directNodeWarmAuth.p50Ms,
              ),
              authOverheadP50: Math.max(
                0,
                nginxWarmAuth.p50Ms - nginxWarmAnon.p50Ms,
              ),
              coldVsWarmCacheRatio: (
                directNodeColdAuth.p50Ms /
                Math.max(0.1, directNodeWarmAuth.p50Ms)
              ).toFixed(2),
            }),
          );

          assert.ok(directNodeWarmAuth.requestsPerSecond > 0);
          assert.ok(nginxWarmAuth.requestsPerSecond > 0);
          assert.ok(nginxWarmAnon.requestsPerSecond > 0);
        },
      );

      await suite.test(
        "remains correct with injected network latency",
        async (t) => {
          const metrics = await runHttpLoad(20, 5, async () => {
            const result = await jsonRequest(
              LATENCY_PROXY_URL,
              "/api/v1/sets",
              {
                token: tokensA.accessToken,
              },
            );
            assert.equal(result.response.status, 200);
          });
          t.diagnostic(
            JSON.stringify({
              workload: "INJECTED_60MS_ONE_WAY_LATENCY",
              ...metrics,
            }),
          );
          assert.ok(metrics.p50Ms >= 100, `p50=${metrics.p50Ms}`);
          assert.ok(metrics.p99Ms <= 2_500, `p99=${metrics.p99Ms}`);
        },
      );

      await suite.test("fails over when one Node instance stops", async (t) => {
        await stack.backends[0]?.stop();
        // Nginx Open Source uses passive health checks. Exercise its workers so
        // the dead peer is marked unavailable, and report the convergence
        // errors separately from the steady-state availability assertion.
        const convergenceResponses = await Promise.all(
          Array.from({ length: 80 }, () =>
            jsonRequest(NGINX_URL, "/api/v1/sets", {
              token: tokensA.accessToken,
            }),
          ),
        );
        t.diagnostic(
          JSON.stringify({
            workload: "NGINX_PASSIVE_FAILOVER_CONVERGENCE",
            successful: convergenceResponses.filter(
              ({ response }) => response.status === 200,
            ).length,
            failed: convergenceResponses.filter(
              ({ response }) => response.status !== 200,
            ).length,
          }),
        );
        await wait(250);

        const responses = await Promise.all(
          Array.from({ length: 30 }, () =>
            jsonRequest(NGINX_URL, "/api/v1/sets", {
              token: tokensA.accessToken,
            }),
          ),
        );
        assert.ok(
          responses.every(({ response }) => response.status === 200),
          JSON.stringify(responses.map(({ response }) => response.status)),
        );
        assert.ok(
          responses.every(({ response }) =>
            (response.headers.get("x-test-upstream") ?? "").includes(":3302"),
          ),
        );
      });
    } finally {
      await stack.stop();
    }
  },
);
