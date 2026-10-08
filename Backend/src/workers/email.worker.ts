import { Worker } from "bullmq";
import { bullmqClient } from "../utils/bullmq";
import { JOB_NAME, QUEUE_NAME } from "../constants/queue.constants";
import { assertBackgroundWorkerRole } from "../utils/backgroundRuntime";
// const connection = new IORedis({ maxRetriesPerRequest: null });
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

let emailWorker: Worker | null = null;

export const startEmailWorker = () => {
  assertBackgroundWorkerRole();
  if (emailWorker || process.env.ENABLE_EMAIL_WORKER !== "true") return;

  emailWorker = new Worker(
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
      connection: bullmqClient.getWorkerConnection(),
      concurrency: 10,
    },
  );
  emailWorker.on("error", (error) => {
    console.error("Email worker error", error);
  });
};

export const closeEmailWorker = async () => {
  if (!emailWorker) return;
  const activeWorker = emailWorker;
  emailWorker = null;
  await activeWorker.close();
};

// emailWorker.on("completed", (job) => {
//   console.log(`${job.id} has completed!`);
// });

// emailWorker.on("failed", (job, err) => {
//   console.log(`${job?.id} has failed with ${err.message}`);
// });
