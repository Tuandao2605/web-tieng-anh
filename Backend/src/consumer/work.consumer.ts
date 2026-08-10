import { ConfirmChannel } from "amqplib";
import { rabbitmqClient } from "../utils/rabbitmq";
const MAIN_QUEUE = "work_queue";
const RETRY_EXCHANGE = "retry_exchange";
const RETRY_QUEUE = "retry_hold_queue";
const workConsumer = {
  async setup() {
    const rabbitmq = rabbitmqClient.getInstance();
    rabbitmq.getOrCreateChannel(
      "WORK_QUEUE_COMSUMER",
      async (channel: ConfirmChannel) => {
        //1. cau hinh queue cho
        await channel.assertExchange(RETRY_EXCHANGE, "direct", {
          durable: true,
        });
        await channel.assertQueue(RETRY_QUEUE, {
          durable: true,
          deadLetterExchange: "", //default exchange
          deadLetterRoutingKey: MAIN_QUEUE,
          messageTtl: 10000, //10s
        });

        await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, "retry_key");

        //2. Cau hinh queue chinh
        await channel.assertQueue(MAIN_QUEUE, {
          durable: true,
          deadLetterExchange: RETRY_EXCHANGE,
          deadLetterRoutingKey: "retry_key",
        });

        channel.consume(MAIN_QUEUE, (msg) => {
          if (!msg) {
            return;
          }
          const xDeath = msg.properties.headers?.["x-death"];
          const retryCount = (xDeath ? xDeath[0]?.count : 0) as number;
          console.log(
            `Nhan tin: ${msg.content.toString()} - Lan thu: ${retryCount}`,
          );
          // Gia lap loi
          try {
            if (msg.content.toString().includes("error")) {
              throw new Error("Tin nhan bi loi");
            }
            console.log("Xu li tin nhan thanh cong");
            channel.ack(msg);
          } catch {
            const MAX_ENTRIES = 3;
            if (retryCount < MAX_ENTRIES) {
              console.log(
                `Loi! Dang day sang queue cho de thu lai lan: ${retryCount + 1}`,
              );
              channel.nack(msg, false, false);
            } else {
              console.log(`Qua 3 lan thu, Xoa vinh vien`);
              channel.ack(msg);
            }
          }
        });
      },
    );
  },
};

workConsumer.setup();
