import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const rabbitmq = rabbitmqClient.getInstance();
// const channelWrapper = rabbitmq.getOrCreateChannel(
//   "TASK_CONSUMER",
//   (channel: ConfirmChannel) => {
//     channel.prefetch(1);
//     return channel.assertQueue("task-queue", {
//       durable: true,
//     });
//   },
// );
// let count = 0;
// const taskConsumer = async () => {
//   if (channelWrapper) {
//     await channelWrapper.assertQueue("task-queue", { durable: true });
//     channelWrapper.consume("task-queue", (msg) => {
//       if (msg) {
//         const { value } = JSON.parse(msg.content.toString());
//         console.log(`Da nhan message: ${value}`);

//         setTimeout(() => {
//           if (value !== "admin@gmail.com") {
//             channelWrapper.ack(msg); // Xac nhan hoan thanh
//             console.log(`Da xu ly xong message: ${value}`);
//           } else {
//             if (count < 1) {
//               channelWrapper.nack(msg, false, true); // day vao queue
//               console.log(
//                 `Xu li message: ${value} that bai, day nguoc vao queue`,
//               );
//             } else {
//               channelWrapper.nack(msg, false, false); // xoa hoac day vao DLX
//               console.log(`Xu li message: ${value} that bai, xoa khoi queue`);
//             }
//             count++;
//           }
//         }, 2000);
//       }
//     });
//   }
// };

// //Debug

// channelWrapper?.on("connect", () => {
//   console.log("Consumer channel connect:", channelWrapper.name);
// });
// channelWrapper?.on("close", () => {
//   console.log("Consumer channel disconnect:", channelWrapper.name);
// });
// channelWrapper?.on("error", (err, { name }) => {
//   console.log("Consumer channel connect:", err, name);
// });

// taskConsumer().catch((err) => {
//   console.log(err);
// });

const taskConsumer = {
  //method xu li cong viec
  onOrderCreate(msg: ConsumeMessage | null, channel: ConfirmChannel) {
    //logic
    if (!msg) {
      return;
    }
    try {
      const content = JSON.parse(msg.content.toString());
      console.log(`Dang xu ly message: ${content.value}`);

      const err = false;
      if (err) {
        throw new Error("Error");
      }
      channel.ack(msg);
    } catch (error) {
      console.log(`Loi xu ly message: ${error}`);
      channel.nack(msg, false, false);
    }
  },
  // onOrderCancel(msg: ConsumeMessage | null) {
  //   //logic
  // },
  async setup() {
    rabbitmq.getOrCreateChannel(
      "TASK_COMSUMER",
      async (channel: ConfirmChannel) => {
        channel.prefetch(1);
        await channel.assertQueue("task-queue");
        await channel.consume("task-queue", (msg) =>
          this.onOrderCreate(msg, channel),
        );
        // await channel.assertQueue("task-queue2");
        // await channel.consume("task-queue2", (msg) => {
        //   this.onOrderCancel(msg);
      },
    );
  },
};

taskConsumer.setup();
