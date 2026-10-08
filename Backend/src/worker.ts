import "dotenv/config";
import { assertBackgroundWorkerRole } from "./utils/backgroundRuntime";

type BackgroundDependencies = {
  scheduler: typeof import("./scheduler");
  searchIndexWorker: typeof import("./workers/search-index.worker");
  emailWorker: typeof import("./workers/email.worker");
  searchIndexQueue: typeof import("./queues/search-index.queue");
  bullmq: typeof import("./utils/bullmq");
  prisma: typeof import("./libs/prisma");
  redis: typeof import("./utils/redis");
};

let dependencies: BackgroundDependencies | null = null;
let isShuttingDown = false;

const shutdown = async (reason: string, startupFailed = false) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Background runtime stopping (${reason})`);
  const forceExitTimer = setTimeout(() => {
    console.error("Background runtime shutdown timed out; forcing exit");
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  const activeDependencies = dependencies;
  let failures: PromiseSettledResult<unknown>[] = [];
  if (activeDependencies) {
    // Stop creating scheduled jobs first, then let active jobs finish before
    // closing the shared BullMQ, Prisma, and Redis connections.
    const workerResults = await Promise.allSettled([
      activeDependencies.scheduler.stopSchedulers(),
      activeDependencies.searchIndexWorker.closeSearchIndexWorker(),
      activeDependencies.emailWorker.closeEmailWorker(),
    ]);
    const queueResults = await Promise.allSettled([
      activeDependencies.searchIndexQueue.closeSearchIndexQueue(),
    ]);
    const resourceResults = await Promise.allSettled([
      activeDependencies.bullmq.closeBullMqConnections(),
      activeDependencies.prisma.prisma.$disconnect(),
      activeDependencies.redis.closeRedisConnections(),
    ]);
    failures = [...workerResults, ...queueResults, ...resourceResults];
  }

  clearTimeout(forceExitTimer);
  const rejected = failures.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  for (const failure of rejected) {
    console.error(
      "Background resource failed to close cleanly",
      failure.reason,
    );
  }
  process.exitCode = startupFailed || rejected.length > 0 ? 1 : 0;
};

const bootstrap = async () => {
  assertBackgroundWorkerRole();

  const [
    scheduler,
    searchIndexWorker,
    emailWorker,
    searchIndexQueue,
    bullmq,
    prisma,
    redis,
  ] = await Promise.all([
    import("./scheduler"),
    import("./workers/search-index.worker"),
    import("./workers/email.worker"),
    import("./queues/search-index.queue"),
    import("./utils/bullmq"),
    import("./libs/prisma"),
    import("./utils/redis"),
  ]);

  dependencies = {
    scheduler,
    searchIndexWorker,
    emailWorker,
    searchIndexQueue,
    bullmq,
    prisma,
    redis,
  };

  // The order subscriber is also a background consumer; keep it in this sole
  // worker runtime instead of creating one subscription per web/API process.
  await import("./subscribers/order");
  await scheduler.startSchedulers();
  searchIndexWorker.startSearchIndexWorker();
  emailWorker.startEmailWorker();
  console.log("Background runtime started (scheduler and queue workers)");
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

void bootstrap().catch(async (error: unknown) => {
  console.error("Unable to start background runtime", error);
  await shutdown("startup failure", true);
});
