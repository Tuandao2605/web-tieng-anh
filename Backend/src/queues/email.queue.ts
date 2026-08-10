import { Queue } from "bullmq";
import { QUEUE_NAME } from "../constants/queue.constants";
import { bullmqClient } from "../utils/bullmq";

const bullmq = bullmqClient.getInstance();

export const emailQueue = new Queue(QUEUE_NAME.EMAIL, {
  connection: bullmq.queue!,
});

// emailQueue.setGlobalConcurrency(10);
