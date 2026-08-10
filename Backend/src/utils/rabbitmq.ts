import amqp, {
  AmqpConnectionManager,
  ChannelWrapper,
} from "amqp-connection-manager";
import { ConfirmChannel } from "amqplib";
type RabbitMqClientType = {
  connection: AmqpConnectionManager | null;
  channels: Map<string, ChannelWrapper>;
  getInstance: () => RabbitMqClientType;
  getOrCreateChannel: (
    name: string,
    setup: (channel: ConfirmChannel) => Promise<void>,
  ) => ChannelWrapper | undefined;
};
export const rabbitmqClient: RabbitMqClientType = {
  connection: null,
  channels: new Map(),
  getInstance() {
    const url = `amqp://${process.env.RABBIT_USERNAME}:${process.env.RABBIT_PASSWORD}@${process.env.RABBIT_HOST}:${process.env.RABBIT_PORT}`;
    if (!this.connection) {
      this.connection = amqp.connect([url]);
      this.connection.on("connect", () => {
        console.log("RabbitMq Connected");
      });
      this.connection.on("disconnect", () => {
        console.log("RabbitMq Disconnected");
      });
    }
    return this;
  },
  getOrCreateChannel(name, setup) {
    if (this.channels.has(name)) {
      return this.channels.get(name);
    }
    const channelWrapper = this.connection?.createChannel({
      name,
      setup,
    });
    if (channelWrapper) {
      this.channels.set(name, channelWrapper);
    }

    return channelWrapper;
  },
};
