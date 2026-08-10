import { Worker } from "bullmq";
import { bullmqClient } from "../utils/bullmq";
import { JOB_NAME, QUEUE_NAME } from "../constants/queue.constants";
// const connection = new IORedis({ maxRetriesPerRequest: null });
const bullmq = bullmqClient.getInstance();

const handleSendEmailWelcome = (data: {
  subject: string;
  message: string;
  to: string;
}) => {
  console.log(
    `Da gui email chao mung toi: ${data.to}, voi subject: ${data.subject}, message: ${data.message}`,
  );
};

const handleSendEmailForgotPassword = async (data: {
  subject: string;
  message: string;
  to: string;
}) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(
    `Da gui email quen mat khau toi: ${data.to}, voi subject: ${data.subject}, message: ${data.message}`,
  );
};

export const emailWorker = new Worker(
  QUEUE_NAME.EMAIL,
  async (job) => {
    switch (job.name) {
      case JOB_NAME.EMAIL.WELCOME: {
        handleSendEmailWelcome(job.data);
        break;
      }
      case JOB_NAME.EMAIL.FORGOT_PASSWORD: {
        await handleSendEmailForgotPassword(job.data);
        break;
      }
      default: {
        throw new Error("Khong tim thay ten job");
      }
    }
  },
  {
    connection: bullmq.worker!,
    concurrency: 10,
  },
);

// emailWorker.on("completed", (job) => {
//   console.log(`${job.id} has completed!`);
// });

// emailWorker.on("failed", (job, err) => {
//   console.log(`${job?.id} has failed with ${err.message}`);
// });
