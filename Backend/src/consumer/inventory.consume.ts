import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const EX = "order_exchange";
const inventoryConsumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "INVENTORY_COMSUMER",
      async (channel: ConfirmChannel) => {
        await channel.assertExchange(EX, "direct", {
          durable: false,
        });
        // Tao queue tam thoi, xoa khi ngat ket noi
        const queue = await channel.assertQueue("inventory-queue", {
          durable: true,
        });

        //binding error
        await channel.bindQueue(queue.queue, EX, "order.created");
        channel.consume(queue.queue, (msg: ConsumeMessage | null) => {
          if (msg) {
            console.log(
              `[INVENTORY_CONSUMER] tru ton hang ton kho : ${msg.content.toString()}`,
            );
            channel.ack(msg);
          }
        });
      },
    );
  },
};

inventoryConsumer.setup();
