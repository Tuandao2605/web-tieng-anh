import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { runtimeConfig } from "../../config/runtime";

type RoomAcknowledgement = (result: {
  status: "ok";
  socketsId?: string[];
}) => void;

const getSocketPort = () => {
  const configuredPort = Number(process.env.WEBSOCKET_PORT);
  return Number.isInteger(configuredPort) && configuredPort > 0
    ? configuredPort
    : 8000;
};

@Injectable()
export class SocketIoGateway implements OnModuleInit, OnModuleDestroy {
  private server: Server | null = null;

  onModuleInit() {
    if (this.server) return;

    this.server = new Server(getSocketPort(), {
      cors: { origin: runtimeConfig.allowedOrigins },
    });

    this.server.sockets.on("connection", (socket: Socket) => {
      socket.on("send-message", () => {
        socket.broadcast.emit("new-message", {
          value: `tin nhan tu server: ${Math.random()}`,
        });
      });

      socket.on(
        "join-room",
        async (room: unknown, acknowledge?: RoomAcknowledgement) => {
          if (typeof room !== "string" || room.length === 0) {
            acknowledge?.({ status: "ok", socketsId: [] });
            return;
          }

          await socket.join(room);
          const roomSockets = await this.server?.in(room).fetchSockets();
          acknowledge?.({
            status: "ok",
            socketsId:
              roomSockets?.map(
                (roomSocket: { id: string }) => roomSocket.id,
              ) ?? [],
          });
        },
      );

      socket.on(
        "leave-room",
        async (room: unknown, acknowledge?: RoomAcknowledgement) => {
          if (typeof room !== "string" || room.length === 0) {
            acknowledge?.({ status: "ok" });
            return;
          }

          await socket.leave(room);
          acknowledge?.({ status: "ok" });
        },
      );
    });

    const notifications = this.server.of("/notifications");
    notifications.on("connection", (socket: Socket) => {
      socket.on("send-noti", () => {
        notifications.emit("new-noti", "Thong bao tu server");
      });
    });
  }

  async onModuleDestroy() {
    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}
