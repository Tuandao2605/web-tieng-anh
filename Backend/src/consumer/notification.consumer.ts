import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "header_exchange";
const notificationConsumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "NOTIFICATION_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "headers", {
          durable: true,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("", {
          exclusive: true,
        });

        //binding error
        await channel.bindQueue(queue.queue, EX, "", {
          "x-match": "all",
          department: "sales",
          location: "Hanoi",
        });
        channel.consume(queue.queue, (msg: ConsumeMessage | null) => {
          if (msg) {
            console.log(
              `[NOTIFICATION] Nhan ban tin: ${msg.content.toString()}`,
            );
            channel.ack(msg);
          }
        });
      },
    );
  },
};

notificationConsumer.setup();
