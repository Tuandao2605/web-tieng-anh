import dotenv from "dotenv";
dotenv.config();

// import cron from "node-cron";
import { emailQueue } from "../queues";
import { JOB_NAME } from "../constants/queue.constants";
// import { apiAuthService } from "../services/apiAuth.service";

// cron.schedule("*/5 * * * * *", () => {
//   console.log("5 giay 1 lan");
//   emailQueue.add(JOB_NAME.EMAIL.WELCOME, {
//     subject: "Chao mung ban den voi unicode",
//     message: "Chao ban, abc",
//     to: "tuan5amtb@gmail.com",
//   });
//   console.log(`Da them job ` + JOB_NAME.EMAIL.WELCOME);
// });

emailQueue.upsertJobScheduler(
  "send-email-welcome-daily",
  {
    pattern: "*/5 * * * * *",
  },
  {
    name: JOB_NAME.EMAIL.WELCOME,
    data: {
      subject: "Chao mung ban den voi unicode",
      message: "Chao ban, abc",
      to: "tuan5amtb@gmail.com",
    },
  },
);
