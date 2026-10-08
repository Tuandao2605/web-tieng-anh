import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "../../types/auth";
import { apiHttpException } from "../../common/exceptions/api-http-exception";

type AuthenticatedUserRequest = FastifyRequest<{
  Params: { id: string };
}> & {
  user?: AuthenticatedUser;
};

@Injectable()
export class SelfUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();
    if (!request.user || request.user.id !== request.params.id) {
      throw apiHttpException(
        "You are not authorized to access this user",
        { code: "FORBIDDEN" },
        403,
      );
    }
    return true;
  }
}
