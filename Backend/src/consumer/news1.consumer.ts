import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "news_fanout";
const news1Consumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "NEWS1_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "fanout", {
          durable: false,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("", {
          durable: true,
        });

        //binding error
        await channel.bindQueue(queue.queue, EX, "");
        channel.consume(queue.queue, (msg: ConsumeMessage | null) => {
          if (msg) {
            console.log(`[News1] Nhan ban tin: ${msg.content.toString()}`);
            channel.ack(msg);
          }
        });
      },
    );
  },
};

news1Consumer.setup();
