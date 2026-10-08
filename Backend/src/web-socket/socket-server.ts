import { Server, Socket } from "socket.io";
import { runtimeConfig } from "../config/runtime";

let io: Server | null = null;

export const startSocketServer = () => {
  if (io) return io;

  const socketServer = new Server(Number(process.env.WEBSOCKET_PORT) || 8000, {
    cors: {
      origin: runtimeConfig.allowedOrigins,
    },
  });
  io = socketServer;

  socketServer.on("connection", (socket: Socket) => {
    console.log("Client da ket noi", socket.id);

    socket.on("send-message", (data) => {
      console.log(data);
      socket.broadcast.emit("new-message", {
        value: "tin nhan tu server: " + Math.random(),
      });
    });
    socket.on("join-room", async (room, callback) => {
      socket.join(room);
      const sockets = await socketServer.in("unicode").fetchSockets();
      const socketsId = sockets.map((connectedSocket) => connectedSocket.id);
      console.log(socketsId);

      callback({ status: "ok", socketsId });
    });
    socket.on("leave-room", (room, callback) => {
      socket.leave(room);
      callback({ status: "ok" });
    });
    socket.on("disconnect", () => {
      console.log("Client da ngat ket noi :", socket.id);
    });
  });

  socketServer.of("/notifications").on("connection", (socket: Socket) => {
    console.log("Notifications da ket noi", socket.id);
    socket.on("send-noti", (data) => {
      console.log(data);
      socketServer.of("/notifications").emit("new-noti", "Thong bao tu server");
    });
    socket.on("disconnect", () => {
      console.log("Notifications da ngat ket noi");
    });
  });

  return io;
};

export const closeSocketServer = () =>
  new Promise<void>((resolve) => {
    if (!io) return resolve();
    const current = io;
    io = null;
    current.close(() => resolve());
  });
