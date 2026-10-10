import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ApiMessage } from "../../common/decorators/api-message.decorator";
import { apiHttpException } from "../../common/exceptions/api-http-exception";
import { ApiRateLimitGuard, JwtAuthGuard } from "../../common/guards/api.guards";
import { SelfUserGuard } from "./users.guards";
import { USERS_SERVICE } from "./users.tokens";
import type { UsersService } from "./users.tokens";

@Controller("api/v1/users")
@UseGuards(ApiRateLimitGuard, JwtAuthGuard, SelfUserGuard)
export class UsersController {
  constructor(
    @Inject(USERS_SERVICE) private readonly service: UsersService,
  ) {}

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Get User Detail Success")
  async find(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const user = await this.service.getUser(
      id,
      typeof query.include === "string" ? { include: query.include } : {},
    );
    if (!user) {
      throw apiHttpException("User not found", {}, HttpStatus.NOT_FOUND);
    }
    return user;
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Update User Success")
  async update(@Param("id") id: string, @Body() body: UpdateUserDto) {
    const userId = id;
    if (!userId) {
      throw apiHttpException("User id is required", {}, HttpStatus.BAD_REQUEST);
    }
    if (userId.length !== 24) {
      throw apiHttpException("Invalid user id", {}, HttpStatus.BAD_REQUEST);
    }

    const update: Parameters<UsersService["updateUser"]>[0] = {};
    if (body.name !== undefined) {
      update.name = body.name;
    }
    if (body.email !== undefined) {
      update.email = body.email;
    }
    if (body.password !== undefined) {
      update.password = body.password;
    }
    if (body.phone !== undefined) {
      update.phone = body.phone;
    }
    return this.service.updateUser(update, userId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Delete User Success")
  delete(@Param("id") id: string) {
    return this.service.deleteUser(id);
  }
}
