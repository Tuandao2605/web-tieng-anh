import "dotenv/config";
import "reflect-metadata";
import type { INestApplicationContext } from "@nestjs/common";
import { assertBackgroundWorkerRole } from "./utils/backgroundRuntime";

type BackgroundDependencies = {
  applicationContext: INestApplicationContext;
  scheduler: typeof import("./scheduler");
  searchIndexWorker: typeof import("./workers/search-index.worker");
  emailWorker: typeof import("./workers/email.worker");
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
    const applicationResults = await Promise.allSettled([
      activeDependencies.applicationContext.close(),
    ]);
    failures = [...workerResults, ...applicationResults];
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
    { NestFactory },
    { ElasticsearchModule },
    { ElasticsearchService },
  ] = await Promise.all([
    import("./scheduler"),
    import("./workers/search-index.worker"),
    import("./workers/email.worker"),
    import("@nestjs/core"),
    import("./modules/elasticsearch/elasticsearch.module"),
    import("./modules/elasticsearch/elasticsearch.service"),
  ]);
  const applicationContext = await NestFactory.createApplicationContext(
    ElasticsearchModule,
    { logger: false },
  );

  dependencies = {
    applicationContext,
    scheduler,
    searchIndexWorker,
    emailWorker,
  };

  await scheduler.startSchedulers();
  searchIndexWorker.startSearchIndexWorker(
    applicationContext.get(ElasticsearchService),
  );
  emailWorker.startEmailWorker();
  console.log("Background runtime started (scheduler and queue workers)");
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

void bootstrap().catch(async (error: unknown) => {
  console.error("Unable to start background runtime", error);
  await shutdown("startup failure", true);
});
