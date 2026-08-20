import IORedis from "ioredis";
type BullMqClient = {
  queue: IORedis | null;
  worker: IORedis | null;
  getQueueConnection: () => IORedis;
  getWorkerConnection: () => IORedis;
  close: () => Promise<void>;
  config: {
    host: string;
    port: number;
  };
};

export const bullmqClient: BullMqClient = {
  queue: null,
  worker: null,
  config: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
  },
  getQueueConnection() {
    if (!this.queue) {
      this.queue = new IORedis(this.config);
    }
    return this.queue;
  },

  getWorkerConnection() {
    if (!this.worker) {
      this.worker = new IORedis({ ...this.config, maxRetriesPerRequest: null });
    }
    return this.worker;
  },

  async close() {
    const connections = [this.queue, this.worker].filter(
      (connection): connection is IORedis => connection !== null,
    );
    this.queue = null;
    this.worker = null;

    await Promise.all(
      connections.map(async (connection) => {
        if (connection.status === "end") return;
        try {
          await connection.quit();
        } catch {
          connection.disconnect();
        }
      }),
    );
  },
};

export const closeBullMqConnections = () => bullmqClient.close();
