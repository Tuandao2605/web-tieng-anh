import { Request, Response } from "express";
// import { pubSubRedis } from "../utils/redis";
// import { rabbitmqClient } from "../utils/rabbitmq";
// import { ConfirmChannel } from "amqplib";
// import { redisClient } from "../utils/redis";
// const redis = redisClient.getInstance();
// const rabbitmq = rabbitmqClient.getInstance();
// const pubSubClient = pubSubRedis.getInstance();
import { emailQueue } from "../queues";
import { JOB_DELAY, JOB_NAME } from "../constants/queue.constants";

export const homeController = {
  index: async (req: Request, res: Response) => {
    return res.render("home");
  },
  testRedis: async (req: Request, res: Response) => {
    // const result = await redis.set("name", "Dao Tuan");
    // const result = await redis.hGetAll("user:101");
    // res.json({ result });
    // await pubSubClient.pubClient?.publish("new-order", "new-order111");
    return res.json({});
  },
  testMq: async (req: Request, res: Response) => {
    //Producer
    //1. Tao queue => assertQueue(tenqueue)
    //2. Dua message vao queue => sendtoQueue
    // const value = req.query.value;
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "TASK_PRODUCER",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertQueue("task-queue", {
    //       durable: true,
    //     });
    //   },
    // );
    // if (channelWrapper) {
    //   const message = {
    //     value,
    //   };
    //   channelWrapper.sendToQueue(
    //     "task-queue",
    //     Buffer.from(JSON.stringify(message)),
    //     {
    //       persistent: true,
    //     },
    //   );
    //   console.log(`Da gui message: ${value}`);
    // }
    // res.json({});

    //Producer direct exchange
    // const logs = [
    //   {
    //     severity: "info",
    //     msg: "He thong vua khoi dong",
    //   },
    //   {
    //     severity: "error",
    //     msg: "Loi ket noi database",
    //   },
    //   {
    //     severity: "warning",
    //     msg: "bo nho ram sap day",
    //   },
    // ];
    // const EX = "logs_redirect";
    // const rabbitmq = rabbitmqClient.getInstance();
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "LOG_CHANNEL",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertExchange(EX, "direct", {
    //       durable: false,
    //     });
    //   },
    // );
    // logs.forEach((log) => {
    //   channelWrapper?.publish(EX, log.severity, Buffer.from(log.msg));
    //   console.log(`Gui ${log.severity}: ${log.msg}`);
    // });

    //Tao don hang -> nhieu queue
    // const EX = "order_exchange";
    // const rabbitmq = rabbitmqClient.getInstance();
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "LOG_CHANNEL",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertExchange(EX, "direct", {
    //       durable: false,
    //     });
    //   },
    // );
    // const order = {
    //   id: 1,
    //   items: ["laptop", "mouse"],
    //   total: 2000,
    // };
    // const routingKey = "order.created";
    // channelWrapper?.publish(EX, routingKey, Buffer.from(JSON.stringify(order)));
    // res.json({});

    //Fanout
    // const EX = "news_fanout";
    // const msg = "Giam gia 50% toan bo cua hang";
    // const rabbitmq = rabbitmqClient.getInstance();
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "NEWS_CHANNEL",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertExchange(EX, "fanout", {
    //       durable: false,
    //     });
    //   },
    // );
    // channelWrapper?.publish(EX, "", Buffer.from(msg));

    //Topic
    // const logs = [
    //   {
    //     key: "asia.mobile.info",
    //     msg: "User HN login",
    //   },
    //   {
    //     key: "asia.web.error",
    //     msg: "Crash at Tokyo server",
    //   },
    //   {
    //     key: "europe.mobile.error",
    //     msg: "Battery drain in Berlin",
    //   },
    //   {
    //     key: "europe.web.info",
    //     msg: "New update in Paris",
    //   },
    // ];
    // const EX = "logs_topic_exchange";
    // const rabbitmq = rabbitmqClient.getInstance();
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "LOGS_TOPIC_CHANNEL",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertExchange(EX, "topic", {
    //       durable: true,
    //     });
    //   },
    // );
    // logs.forEach((log) => {
    //   channelWrapper?.publish(EX, log.key, Buffer.from(log.msg));
    // });

    //Header Exchange
    // const EX = "header_exchange";
    // const rabbitmq = rabbitmqClient.getInstance();
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "NOTIFICATION_CHANNEL",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertExchange(EX, "headers", {
    //       durable: true,
    //     });
    //   },
    // );
    // const msg = "Thong bao thuong cuoi nam";
    // channelWrapper?.publish(EX, "", Buffer.from(msg), {
    //   headers: {
    //     department: "sales",
    //     location: "Hcm",
    //   },
    // });

    //DLX
    // const RETRY_EXCHANGE = "retry_exchange";
    // const channelWrapper = rabbitmq.getOrCreateChannel(
    //   "WORK_QUEUE_PRODUCER",
    //   async (channel: ConfirmChannel) => {
    //     await channel.assertQueue("work-queue", {
    //       durable: true,
    //       deadLetterExchange: RETRY_EXCHANGE,
    //       deadLetterRoutingKey: "retry_key",
    //     });
    //   },
    // );
    // const message = "Xu ly don hang error: 123";
    // channelWrapper?.sendToQueue("work_queue", Buffer.from(message));
    // const userId = 1;
    // const jobId = `${JOB_NAME.EMAIL.FORGOT_PASSWORD}_${userId}`;
    emailQueue.add(
      JOB_NAME.EMAIL.FORGOT_PASSWORD,
      {
        subject: "Ban can lay lai mat khau",
        message: "Chao ban, abc",
        to: "tuan5amtb@gmail.com",
      },
      {
        // jobId,
        removeOnComplete: true,
        removeOnFail: true,
        delay: JOB_DELAY,
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: JOB_DELAY,
        },
      },
    );

    res.json({});
  },
};
