import { Worker } from "bullmq";
import { QUEUE_NAME } from "../constants/queue.constants";
import type { SyncDeckJob } from "../queues/search-index.queue";
import { elasticsearchService } from "../services/elasticsearch.service";
import { bullmqClient } from "../utils/bullmq";

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

let worker: Worker<SyncDeckJob> | null = null;

export const startSearchIndexWorker = () => {
  if (worker || process.env.ENABLE_SEARCH_INDEX_WORKER === "false") return;

  worker = new Worker<SyncDeckJob>(
    QUEUE_NAME.SEARCH_INDEX,
    async (job) => {
      await elasticsearchService.syncDeck(
        job.data.deckId,
        job.data.mutationVersion,
      );
    },
    {
      connection: bullmqClient.getWorkerConnection(),
      concurrency: positiveNumberFromEnv(
        process.env.SEARCH_INDEX_WORKER_CONCURRENCY,
        5,
      ),
    },
  );
  worker.on("error", (error) => {
    console.error("Search index worker error", error);
  });
  worker.on("failed", (job, error) => {
    console.warn(`Search index job ${job?.id ?? "unknown"} failed`, error);
  });
};

export const closeSearchIndexWorker = async () => {
  if (!worker) return;
  const activeWorker = worker;
  worker = null;
  await activeWorker.close();
};
