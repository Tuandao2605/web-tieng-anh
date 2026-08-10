import { WebSocketServer } from "ws";
import { apiAuthService } from "../services/apiAuth.service";
const PORT: unknown = process.env.WEBSOCKET_PORT || 8000;
const wss = new WebSocketServer({
  port: PORT as number,
  verifyClient: async (info, callback) => {
    const protocol = info.req.headers["sec-websocket-protocol"];
    if (!protocol) {
      return callback(false, 401, "Unauthorized");
    }
    const user = await apiAuthService.getProfile(protocol as string);
    if (!user) {
      return callback(false, 401, "Invalid token");
    }
    info.req.user = user;

    callback(true);
  },
});
const CLIENT_ORIGIN = "http://127.0.0.1:5500";

wss.on("connection", function connection(ws, req) {
  console.log("Client da ket noi");
  console.log(req.user);

  // const parsed = url.parse(req.url as string, true);
  // console.log(parsed.query.id);
  const origin = req.headers["origin"];
  if (!origin?.includes(CLIENT_ORIGIN)) {
    ws.close(1008, "Origin not allowed");
  }
  ws.on("error", console.error);

  ws.on("message", function message(data) {
    console.log("receive: %s", data);
    // ws.send("anh em xin chao");
    wss.clients.forEach((client) => {
      if (client != ws && client.readyState === WebSocket.OPEN) {
        client.send("tin nhan tu server");
      }
    });
  });
  ws.on("close", () => {
    console.log("Client da dong ket noi");
  });
});
