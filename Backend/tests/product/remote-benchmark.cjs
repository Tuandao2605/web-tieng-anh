#!/usr/bin/env node
// Run this script from a dedicated load-generator machine. It compares the
// exact same open-loop workload against a directly reachable Node URL and the
// public Nginx URL. It does not require the product-test Docker stack.
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const directNodeUrl = process.env.PRODUCT_DIRECT_NODE_URL;
const nginxUrl = process.env.PRODUCT_NGINX_URL;
const token = process.env.PRODUCT_LOAD_TOKEN;
const userId = process.env.PRODUCT_LOAD_USER_ID;
const targetRps = Number(process.env.PRODUCT_LOAD_TARGET_RPS ?? 500);
const durationMs = Number(process.env.PRODUCT_LOAD_DURATION_MS ?? 30_000);
const maxInFlight = Number(process.env.PRODUCT_LOAD_MAX_IN_FLIGHT ?? 2_000);
const warmupRps = Number(process.env.PRODUCT_LOAD_WARMUP_RPS ?? 20);
const warmupDurationMs = Number(
  process.env.PRODUCT_LOAD_WARMUP_DURATION_MS ?? 2_000,
);

const required = [
  ["PRODUCT_DIRECT_NODE_URL", directNodeUrl],
  ["PRODUCT_NGINX_URL", nginxUrl],
  ["PRODUCT_LOAD_TOKEN", token],
  ["PRODUCT_LOAD_USER_ID", userId],
];
const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  process.stderr.write(`Missing required environment: ${missing.join(", ")}\n`);
  process.exit(2);
}
if (!Number.isInteger(targetRps) || targetRps < 1 || targetRps > 5_000) {
  throw new Error("PRODUCT_LOAD_TARGET_RPS must be an integer from 1 to 5000");
}
if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 600_000) {
  throw new Error("PRODUCT_LOAD_DURATION_MS must be from 1000 to 600000");
}
if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 8_000) {
  throw new Error("PRODUCT_LOAD_MAX_IN_FLIGHT must be from 1 to 8000");
}

const loadScript = join(__dirname, "open-loop-http-load.cjs");
const runLoad = (url, rps, duration) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [loadScript], {
      env: {
        ...process.env,
        PRODUCT_LOAD_URL: url,
        PRODUCT_LOAD_DURATION_MS: String(duration),
        PRODUCT_LOAD_TARGET_RPS: String(rps),
        PRODUCT_LOAD_MAX_IN_FLIGHT: String(maxInFlight),
        PRODUCT_LOAD_TOKEN: token,
        PRODUCT_LOAD_USER_ID: userId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Load process failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Could not parse load output: ${String(error)}\n${stdout}`));
      }
    });
  });

const runTarget = async (label, url) => {
  const warmup = await runLoad(url, warmupRps, warmupDurationMs);
  const measurement = await runLoad(url, targetRps, durationMs);
  return { label, url, warmup, measurement };
};

const main = async () => {
  const order = process.env.PRODUCT_BENCHMARK_ORDER === "nginx-first"
    ? [
        ["nginx", nginxUrl],
        ["directNode", directNodeUrl],
      ]
    : [
        ["directNode", directNodeUrl],
        ["nginx", nginxUrl],
      ];
  const results = [];
  for (const [label, url] of order) {
    results.push(await runTarget(label, url));
  }

  const byLabel = Object.fromEntries(results.map((entry) => [entry.label, entry]));
  const direct = byLabel.directNode.measurement;
  const nginx = byLabel.nginx.measurement;
  process.stdout.write(
    `${JSON.stringify(
      {
        workload: "REMOTE_DIRECT_NODE_VS_NGINX",
        generator: {
          hostname: require("node:os").hostname(),
          platform: process.platform,
          nodeVersion: process.version,
        },
        settings: { targetRps, durationMs, maxInFlight, warmupRps, warmupDurationMs },
        comparisons: {
          successfulRpsRatioNginxToDirect:
            direct.successfulRequestsPerSecond > 0
              ? Number((nginx.successfulRequestsPerSecond / direct.successfulRequestsPerSecond).toFixed(3))
              : null,
          p95DeltaMs: Number((nginx.p95Ms - direct.p95Ms).toFixed(2)),
          p99DeltaMs: Number((nginx.p99Ms - direct.p99Ms).toFixed(2)),
        },
        results,
      },
      null,
      2,
    )}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
