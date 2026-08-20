import { Queue } from "bullmq";
import { QUEUE_NAME } from "../constants/queue.constants";
import { bullmqClient } from "../utils/bullmq";

export const emailQueue = new Queue(QUEUE_NAME.EMAIL, {
  connection: bullmqClient.getQueueConnection(),
});

export const closeEmailQueue = () => emailQueue.close();

// emailQueue.setGlobalConcurrency(10);
