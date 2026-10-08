import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiMessage } from "../../common/decorators/api-message.decorator";

@Controller("api/v1")
export class HealthController {
  @Get("health")
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Nest API is healthy")
  health() {
    return {
      status: "ok",
      framework: "NestJS",
      adapter: "Fastify",
    };
  }
}
