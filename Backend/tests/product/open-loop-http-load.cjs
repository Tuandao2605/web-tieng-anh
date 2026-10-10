/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const https = require("node:https");
const { performance } = require("node:perf_hooks");

const baseUrl = new URL(process.env.PRODUCT_LOAD_URL);
const durationMs = Number(process.env.PRODUCT_LOAD_DURATION_MS);
const targetRps = Number(process.env.PRODUCT_LOAD_TARGET_RPS);
const maxInFlight = Number(process.env.PRODUCT_LOAD_MAX_IN_FLIGHT);
const token = process.env.PRODUCT_LOAD_TOKEN;
const userId = process.env.PRODUCT_LOAD_USER_ID;
const offeredRequests = Math.floor((durationMs * targetRps) / 1_000);
const loadWindowStartedAt = performance.now();
const loadWindowEndsAt = loadWindowStartedAt + durationMs;
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: maxInFlight,
  maxTotalSockets: maxInFlight,
});
const transport = baseUrl.protocol === "https:" ? https : http;
const requestAgent =
  baseUrl.protocol === "https:"
    ? new https.Agent({
        keepAlive: true,
        maxSockets: maxInFlight,
        maxTotalSockets: maxInFlight,
      })
    : agent;

let nextIndex = 0;
let inFlight = 0;
let maxObservedInFlight = 0;
let clientDroppedRequests = 0;
let successfulResponses = 0;
let successfulResponsesDuringWindow = 0;
let maxScheduleLagMs = 0;
const completedLatenciesMs = [];
const responses = {};
const failedResponseSamples = [];

const percentile = (values, percentage) => {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * percentage) - 1,
  );
  return values[Math.max(index, 0)] ?? 0;
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const pathForIndex = (index) => {
  const slot = index % 10;
  if (slot < 7) return "/api/v1/sets";
  if (slot < 9) return "/api/v1/posts";
  return `/api/v1/users/${userId}`;
};

const launchRequest = (index, scheduledAt) => {
  if (inFlight >= maxInFlight) {
    clientDroppedRequests += 1;
    responses.client_dropped = (responses.client_dropped ?? 0) + 1;
    return;
  }

  maxScheduleLagMs = Math.max(maxScheduleLagMs, performance.now() - scheduledAt);
  inFlight += 1;
  maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
  let completed = false;
  let errorBody = "";
  let responseStatus = 0;
  let upstream;
  let upstreamStatus;

  const finish = (status) => {
    if (completed) return;
    completed = true;
    const completedAt = performance.now();
    const responseKey = String(status);
    responses[responseKey] = (responses[responseKey] ?? 0) + 1;
    if (status === 200) {
      successfulResponses += 1;
      if (completedAt <= loadWindowEndsAt) successfulResponsesDuringWindow += 1;
    } else if (failedResponseSamples.length < 20) {
      failedResponseSamples.push({
        path: pathForIndex(index),
        status: responseKey,
        upstream,
        upstreamStatus,
        body: errorBody,
      });
    }
    completedLatenciesMs.push(completedAt - scheduledAt);
    inFlight -= 1;
  };

  const request = transport.request(
    new URL(pathForIndex(index), baseUrl),
    {
      method: "GET",
      agent: requestAgent,
      headers: {
        Authorization: `Bearer ${token}`,
        Connection: "keep-alive",
      },
    },
    (response) => {
      responseStatus = response.statusCode ?? 0;
      upstream = response.headers["x-test-upstream"];
      upstreamStatus = response.headers["x-test-upstream-status"];
      response.on("data", (chunk) => {
        if (responseStatus !== 200 && errorBody.length < 500) {
          errorBody += chunk.toString().slice(0, 500 - errorBody.length);
        }
      });
      response.once("end", () => finish(responseStatus));
      response.once("aborted", () => finish("transport_error"));
      response.once("error", () => finish("transport_error"));
    },
  );

  request.setTimeout(15_000, () => request.destroy(new Error("timeout")));
  request.once("error", () => finish("transport_error"));
  request.end();
};

const run = async () => {
  while (nextIndex < offeredRequests) {
    const elapsedMs = performance.now() - loadWindowStartedAt;
    const dueRequests = Math.min(
      offeredRequests,
      Math.floor((elapsedMs * targetRps) / 1_000) + 1,
    );
    if (nextIndex >= dueRequests) {
      const nextScheduledAt =
        loadWindowStartedAt + (nextIndex * 1_000) / targetRps;
      await delay(Math.max(0, Math.min(10, nextScheduledAt - performance.now())));
      continue;
    }

    while (nextIndex < dueRequests) {
      const index = nextIndex;
      nextIndex += 1;
      launchRequest(
        index,
        loadWindowStartedAt + (index * 1_000) / targetRps,
      );
    }
  }

  while (inFlight > 0) await delay(5);
  requestAgent.destroy();

  const duration = performance.now() - loadWindowStartedAt;
  completedLatenciesMs.sort((left, right) => left - right);
  const completedRequests = completedLatenciesMs.length;
  process.stdout.write(
    `${JSON.stringify({
      offeredRequests,
      launchedRequests: offeredRequests - clientDroppedRequests,
      completedRequests,
      clientDroppedRequests,
      maxInFlight,
      maxObservedInFlight,
      targetRps,
      durationMs: duration,
      loadWindowMs: durationMs,
      requestsPerSecond: completedRequests / (duration / 1_000),
      successfulRequestsPerSecond: successfulResponses / (duration / 1_000),
      successfulRequestsPerSecondDuringWindow:
        successfulResponsesDuringWindow / (durationMs / 1_000),
      maxScheduleLagMs,
      errorRate:
        (offeredRequests - successfulResponses) / Math.max(1, offeredRequests),
      responses,
      p50Ms: percentile(completedLatenciesMs, 0.5),
      p95Ms: percentile(completedLatenciesMs, 0.95),
      p99Ms: percentile(completedLatenciesMs, 0.99),
      failedResponseSamples,
    })}\n`,
  );
};

run().catch((error) => {
  requestAgent.destroy();
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
