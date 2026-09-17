import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const reservePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a Redis test port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const canConnect = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(100);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

const waitUntilReady = async (
  child: ChildProcess,
  port: number,
  readOutput: () => string,
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Redis test server exited with code ${child.exitCode}: ${readOutput()}`,
      );
    }
    if (await canConnect(port)) return;
    await wait(25);
  }
  throw new Error(`Redis test server did not start in time: ${readOutput()}`);
};

export type RedisTestServer = {
  port: number;
  url: string;
  stop: () => Promise<void>;
};

export const startRedisTestServer = async (): Promise<RedisTestServer> => {
  const port = await reservePort();
  const directory = await mkdtemp(
    join(tmpdir(), "english-learning-redis-test-"),
  );
  const child = spawn(
    process.env.REDIS_SERVER_BIN ?? "redis-server",
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(port),
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      directory,
      "--daemonize",
      "no",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    await waitUntilReady(child, port, () => output);
  } catch (error) {
    child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  let stopped = false;
  return {
    port,
    url: `redis://127.0.0.1:${port}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;

      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => child.once("exit", () => resolve())),
          wait(2_000).then(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
          }),
        ]);
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
};
