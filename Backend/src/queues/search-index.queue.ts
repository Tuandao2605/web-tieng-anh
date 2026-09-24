import { Queue } from "bullmq";
import { JOB_NAME, QUEUE_NAME } from "../constants/queue.constants";
import { bullmqClient } from "../utils/bullmq";

export type SyncDeckJob = { deckId: string; mutationVersion: number };

let queue: Queue<SyncDeckJob> | null = null;

const getQueue = () => {
  if (!queue) {
    queue = new Queue<SyncDeckJob>(QUEUE_NAME.SEARCH_INDEX, {
      connection: bullmqClient.getQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }
  return queue;
};

export const enqueueDeckSync = async (
  deckId: string,
  mutationVersion: number,
) => {
  await getQueue().add(JOB_NAME.SEARCH_INDEX.SYNC_DECK, {
    deckId,
    mutationVersion,
  });
};

export const closeSearchIndexQueue = async () => {
  if (!queue) return;
  const activeQueue = queue;
  queue = null;
  await activeQueue.close();
};
