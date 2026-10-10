import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { USER_REPOSITORY, USERS_SERVICE } from "./users.tokens";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { SelfUserGuard } from "./users.guards";
import { UserRepository } from "./users.repository";

@Module({
  controllers: [UsersController],
  providers: [
    UserRepository,
    { provide: USER_REPOSITORY, useExisting: UserRepository },
    UsersService,
    { provide: USERS_SERVICE, useExisting: UsersService },
    ApiRateLimitGuard,
    JwtAuthGuard,
    SelfUserGuard,
  ],
  exports: [UserRepository, USER_REPOSITORY],
})
export class UsersModule {}
