import { Module } from "@nestjs/common";
import { authService } from "../../services/auth.service";
import { AUTH_SERVICE } from "../auth/auth.tokens";
import { WebController } from "./web.controller";
import { WebCsrfGuard, WebSessionGuard } from "./web.guards";

@Module({
  controllers: [WebController],
  providers: [
    { provide: AUTH_SERVICE, useValue: authService },
    WebSessionGuard,
    WebCsrfGuard,
  ],
})
export class WebModule {}
