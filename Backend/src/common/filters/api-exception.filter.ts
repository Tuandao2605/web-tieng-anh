import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import ejs from "ejs";
import { join } from "node:path";

const readExceptionMessage = (payload: unknown) => {
  if (typeof payload === "string") return payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("message" in payload)
  ) {
    return "Request failed";
  }

  const message = payload.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join(", ");
  return "Request failed";
};

const isExplicitApiError = (
  payload: unknown,
): payload is { success: false; error: unknown; message: string } =>
  typeof payload === "object" &&
  payload !== null &&
  "success" in payload &&
  payload.success === false &&
  "error" in payload &&
  "message" in payload &&
  typeof payload.message === "string";

const isLegacyStatusError = (
  payload: unknown,
): payload is { status: "error"; message: string } =>
  typeof payload === "object" &&
  payload !== null &&
  "status" in payload &&
  payload.status === "error" &&
  "message" in payload &&
  typeof payload.message === "string";

const getErrorStatus = (exception: unknown) => {
  if (exception instanceof HttpException) return exception.getStatus();
  if (
    typeof exception === "object" &&
    exception !== null &&
    "status" in exception &&
    typeof exception.status === "number"
  ) {
    return exception.status;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const status = getErrorStatus(exception);
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    if (!request.url.startsWith("/api")) {
      const viewStatus = [403, 404, 500].includes(status) ? status : 500;
      const message =
        exception instanceof NotFoundException
          ? "Duong dan khong ton tai"
          : process.env.NODE_ENV === "production" && status >= 500
          ? "SERVER ERROR"
          : payload === undefined && exception instanceof Error
            ? exception.message
            : readExceptionMessage(payload);
      const html = await ejs.renderFile(
        join(__dirname, `../../views/errors/${viewStatus}.ejs`),
        { message },
      );
      reply.status(status).type("text/html; charset=utf-8").send(html);
      return;
    }

    if (isExplicitApiError(payload) || isLegacyStatusError(payload)) {
      reply.status(status).send(payload);
      return;
    }
    const message =
      exception instanceof NotFoundException
        ? "Duong dan khong ton tai"
        : process.env.NODE_ENV === "production" && status >= 500
        ? "SERVER ERROR"
        : payload === undefined && exception instanceof Error
          ? exception.message
          : readExceptionMessage(payload);

    // Preserve the existing API error shape and HTTP status code.
    reply.status(status).send({ success: false, status, message });
  }
}
