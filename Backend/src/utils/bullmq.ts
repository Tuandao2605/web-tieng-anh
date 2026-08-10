import IORedis from "ioredis";
type BullMqClient = {
  queue: IORedis | null;
  worker: IORedis | null;
  getInstance: () => BullMqClient;
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
    port: Number(process.env.REDIS_PORT) | 6379,
  },
  getInstance() {
    if (!this.queue) {
      this.queue = new IORedis(this.config);
    }

    if (!this.worker) {
      this.worker = new IORedis({ ...this.config, maxRetriesPerRequest: null });
    }
    return this;
  },
};
