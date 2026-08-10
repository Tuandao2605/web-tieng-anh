import { pubSubRedis } from "../utils/redis";
const pubSubClient = pubSubRedis.getInstance();
pubSubClient.subClient?.subscribe("new-order", (data) => {
  console.log(data);
});
