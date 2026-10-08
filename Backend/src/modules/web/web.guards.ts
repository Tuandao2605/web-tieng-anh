import { randomBytes, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "../../types/auth";
import { authService } from "../../services/auth.service";
import type { WebIncomingMessage } from "./web-session.types";
import { apiHttpException } from "../../common/exceptions/api-http-exception";
import { attachWebSession, saveWebSession } from "./web-session.service";

export type WebRequest = FastifyRequest & {
  raw: WebIncomingMessage;
  user?: AuthenticatedUser & { createdAt?: Date };
  csrfToken?: string;
};

const getRequest = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<WebRequest>();

@Injectable()
export class WebSessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequest(context);
    const reply = context.switchToHttp().getResponse();
    await attachWebSession(request, reply);
    const session = request.raw.session;

    if (!session.csrfToken) {
      session.csrfToken = randomBytes(32).toString("base64url");
    }
    request.csrfToken = session.csrfToken;

    if (session.user?.id) {
      const user = await authService.profile(session.user.id);
      if (user) request.user = user;
    }

    await saveWebSession(session);
    return true;
  }
}

const isSameToken = (provided: string, expected: string) => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
};

@Injectable()
export class WebCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = getRequest(context);
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;
    const bodyToken =
      typeof body?._csrf === "string" ? body._csrf : undefined;
    const headerToken = request.headers["x-csrf-token"];
    const providedToken =
      bodyToken ?? (typeof headerToken === "string" ? headerToken : undefined);
    const expectedToken = request.raw.session.csrfToken;

    if (
      !providedToken ||
      !expectedToken ||
      !isSameToken(providedToken, expectedToken)
    ) {
      throw apiHttpException(
        "Yeu cau khong hop le hoac da het han. Vui long tai lai trang.",
        {},
        403,
      );
    }

    if (body && bodyToken) delete body._csrf;
    return true;
  }
}
