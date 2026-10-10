import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import { cpus } from "node:os";
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
const NEST_NODE_1_URL = "http://127.0.0.1:3401";
const NEST_NODE_2_URL = "http://127.0.0.1:3402";
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

const runPacedHttpLoad = async (
  durationMs: number,
  targetRps: number,
  concurrency: number,
  operation: (index: number) => Promise<number>,
) => {
  const total = Math.floor((durationMs * targetRps) / 1_000);
  const startedAt = performance.now();
  let nextIndex = 0;
  const latencies: number[] = [];
  const responses: Record<string, number> = {};

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;

        const scheduledAt = startedAt + (index * 1_000) / targetRps;
        const pacingDelay = scheduledAt - performance.now();
        if (pacingDelay > 0) await wait(pacingDelay);

        const requestStartedAt = performance.now();
        try {
          const status = await operation(index);
          const responseKey = String(status);
          responses[responseKey] = (responses[responseKey] ?? 0) + 1;
        } catch {
          responses.transport_error = (responses.transport_error ?? 0) + 1;
        }
        latencies.push(performance.now() - requestStartedAt);
      }
    }),
  );

  const duration = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  const successful = responses["200"] ?? 0;
  return {
    offeredRequests: total,
    concurrency,
    targetRps,
    durationMs: duration,
    completedRequests: latencies.length,
    requestsPerSecond: latencies.length / (duration / 1_000),
    successfulRequestsPerSecond: successful / (duration / 1_000),
    unsuccessfulResponsesPerSecond:
      (latencies.length - successful) / (duration / 1_000),
    errorRate: (latencies.length - successful) / Math.max(1, latencies.length),
    responses,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
  };
};

const runOpenLoopHttpLoad = async (
  durationMs: number,
  targetRps: number,
  maxInFlight: number,
  token: string,
  userId: string,
) => {
  const output = await runCommand(
    process.execPath,
    [join(__dirname, "open-loop-http-load.cjs")],
    {
      cwd: BACKEND_DIRECTORY,
      env: {
        ...process.env,
        PRODUCT_LOAD_URL: NGINX_URL,
        PRODUCT_LOAD_DURATION_MS: String(durationMs),
        PRODUCT_LOAD_TARGET_RPS: String(targetRps),
        PRODUCT_LOAD_MAX_IN_FLIGHT: String(maxInFlight),
        PRODUCT_LOAD_TOKEN: token,
        PRODUCT_LOAD_USER_ID: userId,
      },
      timeoutMs: Math.max(120_000, durationMs * 10),
    },
  );
  return JSON.parse(output) as {
    offeredRequests: number;
    launchedRequests: number;
    completedRequests: number;
    clientDroppedRequests: number;
    maxInFlight: number;
    maxObservedInFlight: number;
    targetRps: number;
    durationMs: number;
    loadWindowMs: number;
    requestsPerSecond: number;
    successfulRequestsPerSecond: number;
    successfulRequestsPerSecondDuringWindow: number;
    maxScheduleLagMs: number;
    errorRate: number;
    responses: Record<string, number>;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    failedResponseSamples: Array<Record<string, unknown>>;
  };
};

type LinuxProcessSnapshot = {
  systemTicks: number;
  processes: Record<number, { processTicks: number; rssKb: number }>;
};

const readLinuxProcessSnapshot = async (
  pids: number[],
): Promise<LinuxProcessSnapshot | undefined> => {
  if (process.platform !== "linux") return undefined;

  try {
    const cpuStat = await readFile("/proc/stat", "utf8");
    const cpuLine = cpuStat.split("\n", 1)[0];
    if (!cpuLine) return undefined;
    const systemTicks = cpuLine
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number)
      .reduce((total, tick) => total + tick, 0);
    const processEntries = await Promise.all(
      pids.map(async (pid) => {
        try {
          const [stat, status] = await Promise.all([
            readFile(`/proc/${pid}/stat`, "utf8"),
            readFile(`/proc/${pid}/status`, "utf8"),
          ]);
          const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
          const processTicks = Number(fields[11]) + Number(fields[12]);
          const rssKb = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
          return [pid, { processTicks, rssKb }] as const;
        } catch {
          return undefined;
        }
      }),
    );

    return {
      systemTicks,
      processes: Object.fromEntries(
        processEntries.filter(
          (entry): entry is NonNullable<typeof entry> => entry !== undefined,
        ),
      ),
    };
  } catch {
    return undefined;
  }
};

const readRedisResourceMetrics = async (redis: RedisClientType) => {
  const [statsInfo, memoryInfo] = await Promise.all([
    redis.info("stats"),
    redis.info("memory"),
  ]);
  const readField = (info: string, field: string) =>
    Number(info.match(new RegExp(`^${field}:(\\d+)`, "m"))?.[1] ?? 0);
  return {
    totalCommandsProcessed: readField(statsInfo, "total_commands_processed"),
    instantaneousOpsPerSecond: readField(statsInfo, "instantaneous_ops_per_sec"),
    usedMemoryBytes: readField(memoryInfo, "used_memory"),
    peakMemoryBytes: readField(memoryInfo, "used_memory_peak"),
  };
};

const readRuntimePerformanceSamples = (backends: ManagedProcess[]) =>
  backends.flatMap((backend) =>
    backend.logs
      .split("\n")
      .flatMap((line) => {
        const jsonStart = line.indexOf('{"type":"runtime-performance-sample"');
        if (jsonStart < 0) return [];
        try {
          return [JSON.parse(line.slice(jsonStart)) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .slice(-5),
  );

const readMongoResourceMetrics = async (prisma: PrismaClient) => {
  const raw = (await prisma.$runCommandRaw({ serverStatus: 1 })) as Record<
    string,
    unknown
  >;
  const readNumber = (record: unknown, field: string) => {
    if (typeof record !== "object" || record === null || !(field in record)) {
      return 0;
    }
    const value = (record as Record<string, unknown>)[field];
    return typeof value === "number" ? value : 0;
  };
  const operationCounts = raw.opcounters;

  return {
    residentMemoryMb: readNumber(raw.mem, "resident"),
    currentConnections: readNumber(raw.connections, "current"),
    networkBytesIn: readNumber(raw.network, "bytesIn"),
    networkBytesOut: readNumber(raw.network, "bytesOut"),
    operationCount:
      typeof operationCounts === "object" && operationCounts !== null
        ? Object.values(operationCounts).reduce(
            (total, count) => total + (typeof count === "number" ? count : 0),
            0,
          )
        : 0,
  };
};

const collectDockerResourceSnapshot = async () => {
  try {
    const output = await runCommand(
      "docker",
      [
        "stats",
        "--no-stream",
        "--format",
        "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
        "english-learning-product-test-mongo-1",
        "english-learning-product-test-redis-1",
        "english-learning-product-test-elasticsearch-1",
        "english-learning-product-test-nginx-1",
      ],
      { timeoutMs: 15_000 },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    return [`unavailable: ${String(error)}`];
  }
};

const collectProductNginxErrors = async () => {
  try {
    const output = await runCommand(
      "docker",
      [
        "compose",
        "-p",
        COMPOSE_PROJECT,
        "-f",
        COMPOSE_FILE,
        "--profile",
        "proxy",
        "logs",
        "--no-color",
        "--tail=200",
        "nginx",
      ],
      { cwd: BACKEND_DIRECTORY, allowFailure: true, timeoutMs: 15_000 },
    );
    return output
      .split("\n")
      .filter((line) => /\b(error|warn|crit|alert|emerg)\b/i.test(line))
      .slice(-40);
  } catch (error) {
    return [`unavailable: ${String(error)}`];
  }
};

class ProductStack {
  readonly nestBackends: ManagedProcess[] = [];
  private worker: ManagedProcess | null = null;
  private frontend: ManagedProcess | null = null;
  private latencyProxy: TcpLatencyProxy | null = null;
  redis: RedisClientType | null = null;
  prisma: PrismaClient | null = null;

  private get composeArguments() {
    return ["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE];
  }

  async start() {
    assert.ok(
      existsSync(join(BACKEND_DIRECTORY, "dist/src/main.js")),
      "Run npm run build before the product test",
    );

    await runCommand(
      "docker",
      [
        ...this.composeArguments,
        "--profile",
        "proxy",
        "down",
        "--volumes",
        "--remove-orphans",
      ],
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
      // The isolated product benchmark must allow 5k req/s for one shared
      // authenticated identity without the application limiter masking load.
      RATE_LIMIT_MAX_REQUESTS: "1000000",
      RATE_LIMIT_BUCKET_CAPACITY: "1000000",
      RATE_LIMIT_WINDOW_MS: "60000",
      AUTH_RATE_LIMIT_MAX_REQUESTS: "1000",
      AUTH_RATE_LIMIT_WINDOW_MS: "60000",
      HEAVY_RATE_LIMIT_MAX_REQUESTS: "10",
      HEAVY_RATE_LIMIT_WINDOW_MS: "60000",
    };

    for (const [index, port] of [3401, 3402].entries()) {
      const backend = new ManagedProcess(
        `backend-${index + 1}`,
        process.execPath,
        ["dist/src/main.js"],
        {
          cwd: BACKEND_DIRECTORY,
          env: {
            ...sharedEnvironment,
            NEST_PORT: String(port),
            WEBSOCKET_PORT: String(38301 + index),
          },
        },
      );
      this.nestBackends.push(backend);
    }

    await Promise.all([
      waitForHttp(
        `${NEST_NODE_1_URL}/api/v1/health`,
        90_000,
        this.nestBackends[0],
      ),
      waitForHttp(
        `${NEST_NODE_2_URL}/api/v1/health`,
        90_000,
        this.nestBackends[1],
      ),
    ]);

    await Promise.all([
      waitForHttp(
        `${NEST_NODE_1_URL}/api/v1/posts`,
        90_000,
        this.nestBackends[0],
      ),
      waitForHttp(
        `${NEST_NODE_2_URL}/api/v1/posts`,
        90_000,
        this.nestBackends[1],
      ),
    ]);
    for (const baseUrl of [NEST_NODE_1_URL, NEST_NODE_2_URL]) {
      const [getPosts, createPost, updatePost] = await Promise.all([
        fetch(`${baseUrl}/api/v1/posts`),
        fetch(`${baseUrl}/api/v1/posts`, { method: "POST" }),
        fetch(`${baseUrl}/api/v1/posts`, { method: "PUT" }),
      ]);
      if (getPosts.status !== 401 || createPost.status !== 401) {
        throw new Error(
          `Nest posts GET/POST auth contract mismatch: ${getPosts.status}/${createPost.status}`,
        );
      }
      if (updatePost.status !== 200 || (await updatePost.text()) !== "{}") {
        throw new Error(
          `Nest posts PUT placeholder contract mismatch: ${updatePost.status}`,
        );
      }
    }

    this.worker = new ManagedProcess(
      "background-worker",
      process.execPath,
      ["dist/src/worker.js"],
      {
        cwd: BACKEND_DIRECTORY,
        env: {
          ...sharedEnvironment,
          BACKGROUND_RUNTIME_ROLE: "worker",
          ENABLE_EMAIL_WORKER: "true",
        },
      },
    );
    await retry(
      async () => {
        if (!this.worker?.running) {
          throw new Error(this.worker?.logs || "Background worker exited");
        }
        if (!this.worker.logs.includes("Background runtime started")) {
          throw new Error("Background worker has not finished starting");
        }
      },
      30_000,
      "dedicated background worker startup",
    );

    this.frontend = new ManagedProcess(
      "frontend-preview",
      join(FRONTEND_DIRECTORY, "node_modules/.bin/vite"),
      ["preview", "--host", "127.0.0.1", "--port", "34173", "--strictPort"],
      { cwd: FRONTEND_DIRECTORY },
    );
    await waitForHttp(FRONTEND_URL, 60_000, this.frontend);

    await runCommand(
      "docker",
      [
        ...this.composeArguments,
        "--profile",
        "proxy",
        "up",
        "-d",
        "--force-recreate",
        "nginx",
      ],
      { cwd: BACKEND_DIRECTORY, timeoutMs: 120_000 },
    );
    await waitForHttp(`${NGINX_URL}/api/v1/sets`, 60_000);
    const proxiedPosts = await fetch(`${NGINX_URL}/api/v1/posts`);
    if (proxiedPosts.status !== 401) {
      throw new Error(
        `Nginx did not route /api/v1/posts to Nest: ${proxiedPosts.status}`,
      );
    }

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
      this.nestBackends.map((backend) => safely(() => backend.stop())),
    );
    if (this.worker) await safely(() => this.worker!.stop());
    if (this.frontend) await safely(() => this.frontend!.stop());
    await safely(() =>
      runCommand(
        "docker",
        [
          ...this.composeArguments,
          "--profile",
          "proxy",
          "down",
          "--volumes",
          "--remove-orphans",
        ],
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

      await suite.test(
        "serves the migrated static page and EJS auth flow with Redis session and CSRF",
        async () => {
          const root = await fetch(NGINX_URL);
          assert.equal(root.status, 200);
          assert.match(await root.text(), /Disconnect/);

          const loginPage = await fetch(`${NGINX_URL}/auth/login`);
          assert.equal(loginPage.status, 200);
          const loginHtml = await loginPage.text();
          const csrfToken = loginHtml.match(
            /name="_csrf" value="([^"]+)"/,
          )?.[1];
          const sessionCookie = loginPage.headers
            .get("set-cookie")
            ?.split(";", 1)[0];
          assert.ok(csrfToken, "login form must include a CSRF token");
          assert.ok(sessionCookie, "login form must issue a session cookie");

          const rejectedLogin = await fetch(`${NGINX_URL}/auth/login`, {
            method: "POST",
            redirect: "manual",
            headers: {
              Cookie: sessionCookie,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              _csrf: csrfToken,
              email: `missing-${suffix}@example.com`,
              password: "wrong-password",
            }),
          });
          assert.equal(rejectedLogin.status, 302);
          assert.equal(rejectedLogin.headers.get("location"), "/auth/login");

          const loginAfterFailure = await fetch(`${NGINX_URL}/auth/login`, {
            headers: { Cookie: sessionCookie },
          });
          assert.match(
            await loginAfterFailure.text(),
            /Email hoac mat khau khong chinh xac/,
          );
        },
      );

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
            NEST_NODE_1_URL,
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
            NEST_NODE_2_URL,
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

          const loginA = await jsonRequest(
            NEST_NODE_1_URL,
            "/api/v1/auth/login",
            { body: { email: userA.email, password } },
          );
          const loginB = await jsonRequest(
            NEST_NODE_2_URL,
            "/api/v1/auth/login",
            { body: { email: userB.email, password } },
          );
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
            NEST_NODE_2_URL,
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
          const login = await jsonRequest(
            NEST_NODE_1_URL,
            "/api/v1/auth/login",
            {
              body: {
                email: userA.email,
                password: "product-test-password",
              },
            },
          );
          assert.equal(login.response.status, 200, JSON.stringify(login.body));
          const disposableTokens = apiData<Tokens>(login);

          const primedProfiles = await Promise.all(
            [NEST_NODE_1_URL, NEST_NODE_2_URL].map((baseUrl) =>
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
          assert.equal(
            logout.response.status,
            200,
            JSON.stringify(logout.body),
          );

          const rejectedProfiles = await Promise.all(
            [NEST_NODE_1_URL, NEST_NODE_2_URL].map((baseUrl) =>
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

          const created = await jsonRequest(NEST_NODE_1_URL, "/api/v1/sets", {
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
            NEST_NODE_2_URL,
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
          const visibleToB = apiData<{
            sets: Array<{ id: string }>;
            pagination: {
              limit: number;
              hasMore: boolean;
              nextCursor: string | null;
            };
          }>(otherUserList);
          assert.equal(visibleToB.pagination.limit, 20);
          assert.equal(
            visibleToB.sets.some(({ id }) => id === privateDeck.id),
            false,
          );

          const updatedTitle = `Private deck updated ${suffix}`;
          const updated = await jsonRequest(
            NEST_NODE_1_URL,
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
                NEST_NODE_2_URL,
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
        "paginates set summaries with a stable cursor and versioned pages",
        async () => {
          const warmedPage = await jsonRequest(
            NEST_NODE_2_URL,
            "/api/v1/sets?limit=10",
            { token: tokensA.accessToken },
          );
          assert.equal(warmedPage.response.status, 200);

          const createdPages = await Promise.all(
            Array.from({ length: 21 }, (_, index) =>
              jsonRequest(NEST_NODE_1_URL, "/api/v1/sets", {
                token: tokensA.accessToken,
                body: {
                  title: `Paginated deck ${suffix}-${index}`,
                  isPublic: false,
                  cards: [
                    {
                      term: `term-${index}`,
                      definition: `definition-${index}`,
                    },
                  ],
                },
              }),
            ),
          );
          assert.ok(
            createdPages.every(({ response }) => response.status === 201),
          );
          const createdIds = new Set(
            createdPages.map((result) => apiData<Deck>(result).id),
          );

          const firstPageResponse = await jsonRequest(
            NEST_NODE_2_URL,
            "/api/v1/sets?limit=10",
            { token: tokensA.accessToken },
          );
          assert.equal(firstPageResponse.response.status, 200);
          const firstPage = apiData<{
            sets: Array<{ id: string }>;
            pagination: { hasMore: boolean; nextCursor: string | null };
          }>(firstPageResponse);
          assert.equal(firstPage.sets.length, 10);
          assert.equal(firstPage.pagination.hasMore, true);
          assert.ok(firstPage.pagination.nextCursor);
          assert.ok(firstPage.sets.every(({ id }) => createdIds.has(id)));

          const secondPageResponse = await jsonRequest(
            NEST_NODE_1_URL,
            `/api/v1/sets?limit=10&cursor=${firstPage.pagination.nextCursor}`,
            { token: tokensA.accessToken },
          );
          assert.equal(secondPageResponse.response.status, 200);
          const secondPage = apiData<{
            sets: Array<{ id: string }>;
            pagination: { hasMore: boolean; nextCursor: string | null };
          }>(secondPageResponse);
          assert.equal(secondPage.sets.length, 10);
          assert.equal(
            new Set([...firstPage.sets, ...secondPage.sets].map(({ id }) => id))
              .size,
            20,
          );
        },
      );

      await suite.test(
        "indexes and searches public decks through Elasticsearch jobs",
        async () => {
          const searchTerm = `searchable-${suffix}`;
          const created = await jsonRequest(NEST_NODE_2_URL, "/api/v1/sets", {
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
                index % 2 === 0 ? NEST_NODE_1_URL : NEST_NODE_2_URL,
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
            [NEST_NODE_1_URL, NEST_NODE_2_URL, NGINX_URL].map((baseUrl) =>
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
            NEST_NODE_2_URL,
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
          const deadline = Date.now() + 5_000;
          let responses: JsonResponse[];
          let upstreams: string[];
          let observedBothBackends: boolean;
          do {
            responses = await Promise.all(
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
            upstreams = responses.map(
              ({ response }) => response.headers.get("x-test-upstream") ?? "",
            );
            observedBothBackends =
              upstreams.some((value) => value.includes(":3401")) &&
              upstreams.some((value) => value.includes(":3402"));
            if (!observedBothBackends) await wait(250);
          } while (!observedBothBackends && Date.now() < deadline);

          let nginxDiagnostics = "";
          if (!observedBothBackends) {
            const compose = [
              "compose",
              "-p",
              COMPOSE_PROJECT,
              "-f",
              COMPOSE_FILE,
              "--profile",
              "proxy",
            ];
            const [logs, config] = await Promise.all([
              runCommand(
                "docker",
                [...compose, "logs", "--no-color", "--tail", "100", "nginx"],
                { cwd: BACKEND_DIRECTORY, allowFailure: true, timeoutMs: 10_000 },
              ),
              runCommand(
                "docker",
                [...compose, "exec", "-T", "nginx", "nginx", "-T"],
                { cwd: BACKEND_DIRECTORY, allowFailure: true, timeoutMs: 10_000 },
              ),
            ]);
            nginxDiagnostics = JSON.stringify({
              upstreams: [...new Set(upstreams)],
              errors: logs
                .split("\n")
                .filter((line) =>
                  /error|warn|temporarily disabled|connect\(\) failed/i.test(
                    line,
                  ),
                )
                .slice(-30),
              upstreamConfig:
                config.match(/upstream product_backend \{[\s\S]*?\}/)?.[0] ??
                "upstream block not found",
              backends: stack.nestBackends.map((backend) => ({
                name: backend.name,
                running: backend.running,
              })),
            });
          }
          assert.ok(
            observedBothBackends,
            nginxDiagnostics,
          );
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
        "soaks a paced mixed HTTP workload and reports latency, errors, and resource metrics",
        async (t) => {
          const durationMs = positiveIntegerFromEnv(
            process.env.PRODUCT_SOAK_DURATION_MS,
            60_000,
          );
          const targetRps = positiveIntegerFromEnv(
            process.env.PRODUCT_SOAK_TARGET_RPS,
            800,
          );
          const concurrency = positiveIntegerFromEnv(
            process.env.PRODUCT_SOAK_CONCURRENCY,
            50,
          );
          const userVersionKey = `cache:version:sets:user:${userA.id}`;
          const processIds = stack.nestBackends
            .map((backend) => backend.child.pid)
            .filter((pid): pid is number => pid !== undefined);
          const [processBefore, redisBefore, mongoBefore] = await Promise.all([
            readLinuxProcessSnapshot(processIds),
            readRedisResourceMetrics(stack.redis!),
            readMongoResourceMetrics(stack.prisma!),
          ]);
          const dockerDuringSoak = wait(Math.floor(durationMs / 2)).then(
            collectDockerResourceSnapshot,
          );

          const metrics = await runPacedHttpLoad(
            durationMs,
            targetRps,
            concurrency,
            async (index) => {
              // Force a small, regular share of the authenticated sets reads
              // through a version bump so the workload includes cache misses.
              if (index % 100 === 0) {
                await stack.redis!.incr(userVersionKey);
                await stack.redis!.publish(
                  "cache:l1:invalidate:v1",
                  JSON.stringify({
                    source: "product-soak",
                    type: "key",
                    value: userVersionKey,
                  }),
                );
              }

              const slot = index % 10;
              const path =
                slot < 7
                  ? "/api/v1/sets"
                  : slot < 9
                    ? "/api/v1/posts"
                    : `/api/v1/users/${userA.id}`;
              const result = await jsonRequest(NGINX_URL, path, {
                token: tokensA.accessToken,
              });
              return result.response.status;
            },
          );

          const [processAfter, redisAfter, mongoAfter, dockerStats] =
            await Promise.all([
              readLinuxProcessSnapshot(processIds),
              readRedisResourceMetrics(stack.redis!),
              readMongoResourceMetrics(stack.prisma!),
              dockerDuringSoak,
            ]);
          const systemTickDelta =
            processBefore && processAfter
              ? Math.max(1, processAfter.systemTicks - processBefore.systemTicks)
              : 0;
          const nestProcessMetrics = processBefore && processAfter
            ? processIds.map((pid) => {
                const before = processBefore.processes[pid];
                const after = processAfter.processes[pid];
                if (!before || !after) return { pid, available: false };
                return {
                  pid,
                  cpuPercentOfOneCore: Number(
                    (
                      ((after.processTicks - before.processTicks) /
                        systemTickDelta) *
                      cpus().length *
                      100
                    ).toFixed(2),
                  ),
                  rssMb: Number((after.rssKb / 1_024).toFixed(1)),
                };
              })
            : "unavailable outside Linux /proc";
          const unexpectedResponses = Object.fromEntries(
            Object.entries(metrics.responses).filter(
              ([status]) => status !== "200",
            ),
          );

          t.diagnostic(
            JSON.stringify({
              workload: "NGINX_MIXED_HTTP_SOAK",
              ...metrics,
              endpoints: {
                "GET /api/v1/sets": "70% (with periodic cache misses)",
                "GET /api/v1/posts": "20%",
                "GET /api/v1/users/:id": "10%",
              },
              resources: {
                nestProcesses: nestProcessMetrics,
                runtimePerformanceSamples: readRuntimePerformanceSamples(
                  stack.nestBackends,
                ),
                redis: {
                  ...redisAfter,
                  commandsDuringSoak:
                    redisAfter.totalCommandsProcessed -
                    redisBefore.totalCommandsProcessed,
                },
                mongo: {
                  ...mongoAfter,
                  operationsDuringSoak:
                    mongoAfter.operationCount - mongoBefore.operationCount,
                  networkBytesInDuringSoak:
                    mongoAfter.networkBytesIn - mongoBefore.networkBytesIn,
                  networkBytesOutDuringSoak:
                    mongoAfter.networkBytesOut - mongoBefore.networkBytesOut,
                },
                dockerDuringSoak: dockerStats,
              },
            }),
          );

          assert.ok(
            metrics.requestsPerSecond >= targetRps * 0.95,
            `actual RPS ${metrics.requestsPerSecond} was below paced target ${targetRps}`,
          );
          assert.ok(
            metrics.errorRate <= 0.001,
            `error rate ${metrics.errorRate}; non-200 responses: ${JSON.stringify(unexpectedResponses)}`,
          );
          assert.ok(metrics.p99Ms <= 2_000, `p99=${metrics.p99Ms}ms`);
        },
      );

      await suite.test(
        "sustains a mixed HTTP workload up to 5,000 req/s",
        async (t) => {
          const durationMs = positiveIntegerFromEnv(
            process.env.PRODUCT_MAX_RPS_DURATION_MS,
            30_000,
          );
          const targetRps = positiveIntegerFromEnv(
            process.env.PRODUCT_MAX_RPS_TARGET,
            5_000,
          );
          const maxInFlight = positiveIntegerFromEnv(
            process.env.PRODUCT_MAX_RPS_MAX_IN_FLIGHT,
            8_000,
          );
          assert.ok(
            targetRps <= 5_000,
            `PRODUCT_MAX_RPS_TARGET must be at most 5000, received ${targetRps}`,
          );
          assert.ok(
            maxInFlight <= 8_000,
            `PRODUCT_MAX_RPS_MAX_IN_FLIGHT must be at most 8000, received ${maxInFlight}`,
          );

          const processIds = stack.nestBackends
            .map((backend) => backend.child.pid)
            .filter((pid): pid is number => pid !== undefined);
          const [processBefore, redisBefore, mongoBefore] = await Promise.all([
            readLinuxProcessSnapshot(processIds),
            readRedisResourceMetrics(stack.redis!),
            readMongoResourceMetrics(stack.prisma!),
          ]);
          const metrics = await runOpenLoopHttpLoad(
            durationMs,
            targetRps,
            maxInFlight,
            tokensA.accessToken,
            userA.id,
          );

          const [
            processAfter,
            redisAfter,
            mongoAfter,
            dockerStats,
            nginxErrors,
          ] =
            await Promise.all([
              readLinuxProcessSnapshot(processIds),
              readRedisResourceMetrics(stack.redis!),
              readMongoResourceMetrics(stack.prisma!),
              collectDockerResourceSnapshot(),
              metrics.errorRate > 0 ? collectProductNginxErrors() : [],
            ]);
          const systemTickDelta =
            processBefore && processAfter
              ? Math.max(1, processAfter.systemTicks - processBefore.systemTicks)
              : 0;
          const nestProcessMetrics = processBefore && processAfter
            ? processIds.map((pid) => {
                const before = processBefore.processes[pid];
                const after = processAfter.processes[pid];
                if (!before || !after) return { pid, available: false };
                return {
                  pid,
                  cpuPercentOfOneCore: Number(
                    (
                      ((after.processTicks - before.processTicks) /
                        systemTickDelta) *
                      cpus().length *
                      100
                    ).toFixed(2),
                  ),
                  rssMb: Number((after.rssKb / 1_024).toFixed(1)),
                };
              })
            : "unavailable outside Linux /proc";
          const unexpectedResponses = Object.fromEntries(
            Object.entries(metrics.responses).filter(
              ([status]) => status !== "200",
            ),
          );

          t.diagnostic(
            JSON.stringify({
              workload: "NGINX_MIXED_HTTP_MAX_5000_RPS",
              ...metrics,
              failedResponseSamples: metrics.failedResponseSamples,
              nginxErrors,
              endpoints: {
                "GET /api/v1/sets": "70% (warm cache)",
                "GET /api/v1/posts": "20%",
                "GET /api/v1/users/:id": "10%",
              },
              resources: {
                nestProcesses: nestProcessMetrics,
                runtimePerformanceSamples: readRuntimePerformanceSamples(
                  stack.nestBackends,
                ),
                redis: {
                  ...redisAfter,
                  commandsDuringLoad:
                    redisAfter.totalCommandsProcessed -
                    redisBefore.totalCommandsProcessed,
                },
                mongo: {
                  ...mongoAfter,
                  operationsDuringLoad:
                    mongoAfter.operationCount - mongoBefore.operationCount,
                  networkBytesInDuringLoad:
                    mongoAfter.networkBytesIn - mongoBefore.networkBytesIn,
                  networkBytesOutDuringLoad:
                    mongoAfter.networkBytesOut - mongoBefore.networkBytesOut,
                },
                docker: dockerStats,
              },
            }),
          );

          // High concurrency can trip Nginx's passive upstream health checks.
          // Reset only the isolated test proxy so later contract tests start
          // from a clean edge state, even when this performance assertion fails.
          try {
            await Promise.all(
              stack.nestBackends.map((backend, index) =>
                waitForHttp(
                  `${index === 0 ? NEST_NODE_1_URL : NEST_NODE_2_URL}/api/v1/health`,
                  10_000,
                  backend,
                ),
              ),
            );
          } finally {
            await runCommand(
              "docker",
              [
                "compose",
                "-p",
                COMPOSE_PROJECT,
                "-f",
                COMPOSE_FILE,
                "--profile",
                "proxy",
                "restart",
                "nginx",
              ],
              { cwd: BACKEND_DIRECTORY, timeoutMs: 30_000 },
            );
            await waitForHttp(`${NGINX_URL}/api/v1/health`, 30_000);
          }

          assert.ok(
            metrics.successfulRequestsPerSecondDuringWindow >= targetRps * 0.95,
            `successful RPS during load window ${metrics.successfulRequestsPerSecondDuringWindow} was below 95% of target ${targetRps}`,
          );
          assert.ok(
            metrics.errorRate <= 0.001,
            `error rate ${metrics.errorRate}; non-200 responses: ${JSON.stringify(unexpectedResponses)}`,
          );
          assert.ok(metrics.p99Ms <= 2_000, `p99=${metrics.p99Ms}ms`);
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
          await jsonRequest(NEST_NODE_1_URL, "/api/v1/sets", {
            token: tokensA.accessToken,
          });
          await jsonRequest(NEST_NODE_1_URL, "/api/v1/sets");

          // 1. Direct Node.js vs Nginx (Authenticated, Warm Cache)
          const directNodeWarmAuth = await runHttpLoad(
            benchmarkRequests,
            benchmarkConcurrency,
            async () => {
              const res = await jsonRequest(NEST_NODE_1_URL, "/api/v1/sets", {
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
          const userVersionKey = `cache:version:sets:user:${userA.id}`;
          for (let index = 0; index < coldSamples; index += 1) {
            await stack.redis?.incr(userVersionKey);
            await stack.redis?.publish(
              "cache:l1:invalidate:v1",
              JSON.stringify({
                source: "product-benchmark",
                type: "key",
                value: userVersionKey,
              }),
            );
            const start = performance.now();
            const res = await jsonRequest(NEST_NODE_1_URL, "/api/v1/sets", {
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

      await suite.test(
        "rejects abusive auth traffic and oversized authorization at Nginx",
        async () => {
          const oversizedHeader = await jsonRequest(NGINX_URL, "/api/v1/sets", {
            headers: {
              Authorization: `Bearer ${"a".repeat(4_090)}`,
            },
          });
          assert.equal(oversizedHeader.response.status, 431);
          assert.equal(
            oversizedHeader.response.headers.get("x-test-upstream"),
            null,
            "Nginx must reject the request before selecting a Node upstream",
          );

          const attempts = await Promise.all(
            Array.from({ length: 100 }, (_, index) =>
              jsonRequest(NGINX_URL, "/api/v1/auth/login", {
                body: {
                  email: `missing-${suffix}-${index}@example.com`,
                  password: "product-test-password",
                },
              }),
            ),
          );
          const statuses = attempts.map(({ response }) => response.status);
          assert.ok(
            statuses.includes(429),
            `expected Nginx 429 responses, received ${JSON.stringify(statuses)}`,
          );
          assert.ok(
            statuses.includes(400),
            `expected some admitted requests to reach Node, received ${JSON.stringify(statuses)}`,
          );
          assert.ok(
            attempts
              .filter(({ response }) => response.status === 429)
              .every(
                ({ response }) =>
                  response.headers.get("x-test-upstream") === null,
              ),
            "edge-limited requests must not reach a Node upstream",
          );
        },
      );

      await suite.test("fails over when one Nest instance stops", async (t) => {
        await stack.nestBackends[0]?.stop();
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
            (response.headers.get("x-test-upstream") ?? "").includes(":3402"),
          ),
        );
      });
    } finally {
      await stack.stop();
    }
  },
);
