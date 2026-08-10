import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "logs_topic_exchange";
const logTopicConsumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "LOGS_TOPIC_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "topic", {
          durable: true,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("", {
          exclusive: true,
        });

        const routingKey = "asia.#";
        //binding error
        await channel.bindQueue(queue.queue, EX, routingKey);
        channel.consume(queue.queue, (msg: ConsumeMessage | null) => {
          if (msg) {
            console.log(`[LOGS_TOPIC] Nhan ban tin: ${msg.content.toString()}`);
            channel.ack(msg);
          }
        });
      },
    );
  },
};

logTopicConsumer.setup();
