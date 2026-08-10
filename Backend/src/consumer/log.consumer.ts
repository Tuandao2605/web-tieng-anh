import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "logs_redirect";
const logConsumer = {
  //method xu ly cong viec
  onErrorLog(msg: ConsumeMessage | null, channel: ConfirmChannel) {
    if (msg) {
      console.log(`[XU LY GAP]: Nhan loi: ${msg.content.toString()}`);
      channel.ack(msg);
    }
  },
  onAllLog(msg: ConsumeMessage | null, channel: ConfirmChannel) {
    if (msg) {
      console.log(`[THEO DOI]: Nhan log: ${msg.content.toString()}`);
      channel.ack(msg);
    }
  },
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "LOG_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "direct", {
          durable: false,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("", {
          exclusive: true,
        });

        //binding error
        await channel.bindQueue(queue.queue, EX, "error");
        channel.consume(queue.queue, (msg) => this.onErrorLog(msg, channel));

        // binding all
        const queueAllLog = await channel.assertQueue("", {
          exclusive: true,
        });

        ["error", "warning", "info"].forEach((type: string) => {
          channel.bindQueue(queueAllLog.queue, EX, type);
        });
        channel.consume(queueAllLog.queue, (msg) =>
          this.onAllLog(msg, channel),
        );
      },
    );
  },
};

logConsumer.setup();
