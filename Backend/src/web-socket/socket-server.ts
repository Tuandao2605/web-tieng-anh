import { Server, Socket } from "socket.io";
import { runtimeConfig } from "../config/runtime";

const io = new Server(Number(process.env.WEBSOCKET_PORT) || 8000, {
  cors: {
    origin: runtimeConfig.allowedOrigins,
  },
});

export const closeSocketServer = () =>
  new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
//Middleware
// io.use((socket, next) => {
//   console.log("Socket middleware");
//   const token =
//     socket.handshake.auth.token ||
//     socket.handshake.headers["authorization"]?.split(" ").slice(-1).join();
//   if (token === "123") {
//     socket.data.user = "dao tuan";
//     next();
//   } else {
//     next(new Error("Unauthorized"));
//   }
// });

// io.use((socket, next) => {
//   console.log("Rate limit middleware");
//   next();
// });
// let socketId: string;

io.on("connection", (socket: Socket) => {
  console.log("Client da ket noi", socket.id);

  socket.on("send-message", (data) => {
    console.log(data);

    // io.to("unicode").emit("new-message", {
    //   value: "tin nhan tu server: " + Math.random(),
    // });
    socket.broadcast.emit("new-message", {
      value: "tin nhan tu server: " + Math.random(),
    });
  });
  socket.on("join-room", async (room, callback) => {
    socket.join(room);
    const sockets = await io.in("unicode").fetchSockets();
    const socketsId = sockets.map((socket) => socket.id);
    console.log(socketsId);

    callback({
      status: "ok",
      socketsId,
    });
  });
  socket.on("leave-room", (room, callback) => {
    socket.leave(room);

    callback({
      status: "ok",
    });
  });
  socket.on("disconnect", () => {
    console.log("Client da ngat ket noi :", socket.id);
  });
});

io.of("/notifications").on("connection", (socket) => {
  console.log("Notifications da ket noi", socket.id);
  socket.on("send-noti", (data) => {
    console.log(data);
    io.of("/notifications").emit("new-noti", "Thong bao tu server");
  });
  socket.on("disconnect", () => {
    console.log("Notifications da ngat ket noi");
  });
});
