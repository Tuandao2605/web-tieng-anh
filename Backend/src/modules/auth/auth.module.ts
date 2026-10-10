import { Global, Module } from "@nestjs/common";
import { ApiAuthService } from "./api-auth.service";
import { AuthService } from "./auth.service";
import {
  ApiRateLimitGuard,
  JwtAuthGuard,
  SensitiveAuthRateLimitGuard,
} from "../../common/guards/api.guards";
import { AuthController } from "./auth.controller";
import { API_AUTH_SERVICE, AUTH_SERVICE } from "./auth.tokens";
import { UserRepository } from "../users/users.repository";
import { USER_REPOSITORY } from "../users/users.tokens";
import { AccessTokenService } from "../../common/services/access-token.service";
import { MailModule } from "../mail/mail.module";

@Global()
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    UserRepository,
    { provide: USER_REPOSITORY, useExisting: UserRepository },
    AccessTokenService,
    ApiAuthService,
    { provide: API_AUTH_SERVICE, useExisting: ApiAuthService },
    AuthService,
    { provide: AUTH_SERVICE, useExisting: AuthService },
    ApiRateLimitGuard,
    JwtAuthGuard,
    SensitiveAuthRateLimitGuard,
  ],
  exports: [API_AUTH_SERVICE, AUTH_SERVICE, AccessTokenService],
})
export class AuthModule {}
