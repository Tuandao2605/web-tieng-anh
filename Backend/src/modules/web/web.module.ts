import { Module } from "@nestjs/common";
import { WebController } from "./web.controller";
import { WebCsrfGuard, WebSessionGuard } from "./web.guards";
import { WebSessionService } from "./web-session.service";
import { SocketIoGateway } from "./socket-io.gateway";

@Module({
  controllers: [WebController],
  providers: [
    WebSessionService,
    WebSessionGuard,
    WebCsrfGuard,
    SocketIoGateway,
  ],
})
export class WebModule {}
