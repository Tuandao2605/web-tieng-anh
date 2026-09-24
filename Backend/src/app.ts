import { runtimeConfig } from "./config/runtime";
import express, { Application } from "express";
import path from "node:path";
import expressLayouts from "express-ejs-layouts";
import morgan from "morgan";
import "./subscribers/order";
// import "./consumer";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import routerWeb from "./routes/web";
import routerApi from "./routes/api";
import session from "express-session";
import { RedisStore } from "connect-redis";
import flash from "connect-flash";
import {
  errorHandlingMiddleware,
  notFoundMiddleware,
} from "./middlewares/error.middleware";
import { closeRedisConnections, redisClient } from "./utils/redis";
import { prisma } from "./libs/prisma";
import { closeBullMqConnections } from "./utils/bullmq";
import { startSchedulers, stopSchedulers } from "./scheduler";
import { closeSocketServer } from "./web-socket/socket-server";
import { csrfProtection } from "./middlewares/csrf.middleware";
import type { ErrorWithStatus } from "./types/error";
import { attachAbortSignal } from "./middlewares/abortSignal";
import {
  closeSearchIndexWorker,
  startSearchIndexWorker,
} from "./workers/search-index.worker";
import { closeSearchIndexQueue } from "./queues/search-index.queue";

const app: Application = express();
const { isProduction, port, sessionSecret, sessionCookieName, sessionTtlMs } =
  runtimeConfig;

const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy && trustProxy !== "false") {
  if (trustProxy === "true") {
    throw new Error(
      "TRUST_PROXY=true trusts every proxy. Configure trusted IPs/CIDRs or a fixed hop count instead.",
    );
  }

  const trustProxySetting = /^\d+$/.test(trustProxy)
    ? Number(trustProxy)
    : trustProxy.split(",").map((entry) => entry.trim());
  app.set("trust proxy", trustProxySetting);
}

app.use(
  helmet({
    // The server-rendered pages currently load Tailwind and SweetAlert from
    // jsDelivr and contain a small inline script. Keep those explicit while
    // retaining Helmet's remaining CSP protections.
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // Third-party CDN assets do not consistently send CORP headers.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: isProduction
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  }),
);

if (process.env.NODE_ENV === "development") {
  app.use(morgan("tiny"));
}
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(expressLayouts);
app.use(express.static("public"));

const webSessionMiddleware = session({
  name: sessionCookieName,
  store: new RedisStore({
    client: redisClient.getInstance(),
    prefix: "session:web:",
    ttl: Math.ceil(sessionTtlMs / 1000),
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  unset: "destroy",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: sessionTtlMs,
    priority: "high",
  },
});

app.set("layout", "layouts/main.layouts.ejs");
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const allowedOrigins = new Set(runtimeConfig.allowedOrigins);

// Cors
const corsOptions: CorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Cho phép: request không có origin (curl, server-to-server) hoặc nằm trong whitelist
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      const error: ErrorWithStatus = new Error(`Disallow by cors: ${origin}`);
      error.status = 403;
      callback(error);
    }
  },
  optionsSuccessStatus: 200,
  credentials: true,
  allowedHeaders: ["Authorization", "Content-Type"],
  // Browser cache preflight Authorization/JSON requests for one day.
  maxAge: 86400,
};

// JWT APIs do not need express-session. Mounting them first avoids allocating,
// loading and saving a server session for every API request.
app.use("/api", cors(corsOptions), attachAbortSignal, routerApi);
// Session and flash are only needed by the server-rendered web routes.
app.use(webSessionMiddleware);
app.use(flash());
app.use(csrfProtection);
//Route
app.use(routerWeb);

app.use(notFoundMiddleware);
app.use(errorHandlingMiddleware);

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Khoi dong server tai: http://localhost:${port}`);
});

// Nginx keeps upstream sockets for 60 seconds. Node's 5-second default can
// otherwise make Nginx reuse a socket just as Node closes it, causing sporadic
// 502 responses under concurrent traffic. headersTimeout must remain greater
// than keepAliveTimeout so slow/incomplete requests are still bounded safely.
server.keepAliveTimeout = runtimeConfig.httpKeepAliveTimeoutMs;
server.headersTimeout = runtimeConfig.httpHeadersTimeoutMs;

void startSchedulers().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Unable to start schedulers", error);
});
startSearchIndexWorker();

let isShuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // eslint-disable-next-line no-console
  console.log(`Received ${signal}; shutting down gracefully`);
  const forceExitTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  const closeHttpServer = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  const drainResults = await Promise.allSettled([
    closeHttpServer,
    closeSocketServer(),
  ]);

  // Request handlers no longer need shared resources after HTTP has drained.
  const resourceResults = await Promise.allSettled([
    stopSchedulers(),
    closeSearchIndexWorker(),
    closeSearchIndexQueue(),
  ]);
  const databaseResults = await Promise.allSettled([prisma.$disconnect()]);
  const bullMqResult = await Promise.allSettled([closeBullMqConnections()]);
  const redisResult = await Promise.allSettled([closeRedisConnections()]);

  clearTimeout(forceExitTimer);
  const failed = [
    ...drainResults,
    ...resourceResults,
    ...databaseResults,
    ...bullMqResult,
    ...redisResult,
  ].filter((result) => result.status === "rejected");

  for (const failure of failed) {
    if (failure.status === "rejected") {
      // eslint-disable-next-line no-console
      console.error("Resource failed to close cleanly", failure.reason);
    }
  }
  process.exit(failed.length > 0 ? 1 : 0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
