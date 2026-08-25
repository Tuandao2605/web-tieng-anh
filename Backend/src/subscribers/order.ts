import { pubSubRedis } from "../utils/redis";
const pubSubClient = pubSubRedis.getInstance();
const subClient = pubSubClient.subClient;

const subscribeToOrders = () => {
  if (!subClient) return;

  void subClient
    .subscribe("new-order", (data) => {
      console.log(data);
    })
    .catch((error: unknown) => {
      console.error("Unable to subscribe to Redis order channel", error);
    });
};

if (subClient?.isReady) {
  subscribeToOrders();
} else {
  subClient?.once("ready", subscribeToOrders);
}
