import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "order_exchange";
const emailConsumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "EMAIL_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "direct", {
          durable: false,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("email-queue", {
          durable: true,
        });

        //binding error
        await channel.bindQueue(queue.queue, EX, "order.created");
        channel.consume(queue.queue, (msg: ConsumeMessage | null) => {
          if (msg) {
            console.log(
              `[Email]: gui email xac nhan don hang: ${msg.content.toString()}`,
            );
            channel.ack(msg);
          }
        });
      },
    );
  },
};

emailConsumer.setup();
