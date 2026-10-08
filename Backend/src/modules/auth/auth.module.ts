import { Module } from "@nestjs/common";
import { apiAuthService } from "../../services/apiAuth.service";
import { authService } from "../../services/auth.service";
import { ApiRateLimitGuard, JwtAuthGuard, SensitiveAuthRateLimitGuard } from "../../common/guards/api.guards";
import { AuthController } from "./auth.controller";
import { API_AUTH_SERVICE, AUTH_SERVICE } from "./auth.tokens";

@Module({
  controllers: [AuthController],
  providers: [
    { provide: API_AUTH_SERVICE, useValue: apiAuthService },
    { provide: AUTH_SERVICE, useValue: authService },
    ApiRateLimitGuard,
    JwtAuthGuard,
    SensitiveAuthRateLimitGuard,
  ],
})
export class AuthModule {}
