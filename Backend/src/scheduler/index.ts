import { emailQueue } from "../queues";
import { JOB_NAME } from "../constants/queue.constants";

const EMAIL_SCHEDULER_ID = "send-email-welcome";
const LEGACY_EMAIL_SCHEDULER_ID = "send-email-welcome-daily";
let started = false;

export const startSchedulers = async () => {
  if (started) return;

  // Clean up the old development scheduler that ran every five seconds. Also
  // remove the current scheduler when disabled so a persisted Redis schedule
  // cannot keep producing jobs after a configuration change or deployment.
  await emailQueue.removeJobScheduler(LEGACY_EMAIL_SCHEDULER_ID);
  if (process.env.ENABLE_EMAIL_SCHEDULER !== "true") {
    await emailQueue.removeJobScheduler(EMAIL_SCHEDULER_ID);
    return;
  }

  const recipient = process.env.EMAIL_SCHEDULER_TO?.trim();
  if (!recipient) {
    throw new Error(
      "EMAIL_SCHEDULER_TO is required when ENABLE_EMAIL_SCHEDULER=true",
    );
  }

  await emailQueue.upsertJobScheduler(
    EMAIL_SCHEDULER_ID,
    { pattern: process.env.EMAIL_SCHEDULER_CRON ?? "0 9 * * *" },
    {
      name: JOB_NAME.EMAIL.WELCOME,
      data: {
        subject: "Chao mung ban den voi Quizlet Pro",
        message: "Chao mung ban quay lai hoc tap.",
        to: recipient,
      },
    },
  );
  started = true;
};

export const stopSchedulers = async () => {
  // BullMQ job schedulers are persisted in Redis. Closing the Queue releases
  // this process' sockets without deleting the configured schedule.
  started = false;
  await emailQueue.close();
};
