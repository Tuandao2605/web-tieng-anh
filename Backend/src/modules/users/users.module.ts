import { Module } from "@nestjs/common";
import { usersService } from "../../services/users.service";
import { UsersController } from "./users.controller";
import { USERS_SERVICE } from "./users.tokens";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { SelfUserGuard } from "./users.guards";

@Module({
  controllers: [UsersController],
  providers: [
    { provide: USERS_SERVICE, useValue: usersService },
    ApiRateLimitGuard,
    JwtAuthGuard,
    SelfUserGuard,
  ],
})
export class UsersModule {}
