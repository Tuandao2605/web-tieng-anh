import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedUser, RequestAuthContext } from "../../types/auth";
import { apiAuthService } from "../../services/apiAuth.service";
import {
  consumeHeavyRateLimitToken,
  consumeRateLimitToken,
  consumeSensitiveAuthRateLimitToken,
} from "../../services/rateLimit.service";
import {
  extractBearerToken,
  verifyAccessTokenCached,
} from "../../services/accessToken.service";
import { apiHttpException } from "../exceptions/api-http-exception";

type AuthenticatedFastifyRequest = FastifyRequest & {
  authContext?: RequestAuthContext;
  user?: AuthenticatedUser;
  token: string | undefined;
};

const getRequest = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();

const getAccessToken = (request: FastifyRequest) => {
  const authorization = request.headers.authorization;
  return typeof authorization === "string"
    ? extractBearerToken(authorization)
    : null;
};

let lastRateLimitFailureLogAt = 0;
const logRateLimitFailure = (name: string, error: unknown) => {
  const now = Date.now();
  if (now - lastRateLimitFailureLogAt < 30_000) return;
  lastRateLimitFailureLogAt = now;
  console.error(`${name} Redis error`, error);
};

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequest(context);
    const token = getAccessToken(request);
    const principal = token ? verifyAccessTokenCached(token) : null;
    const authContext: RequestAuthContext = {
      token,
      principal,
      blacklistChecked: principal === null,
      revoked: false,
    };
    request.authContext = authContext;

    const clientIp = request.ip ?? request.socket.remoteAddress;
    const identity = principal
      ? `user:${principal.user.id}`
      : clientIp
        ? `ip:${clientIp}`
        : undefined;
    if (!identity) return true;

    let result;
    try {
      // Redis owns the atomic bucket and
      // checks blacklist in the same pipeline when a valid token is present.
      result = await consumeRateLimitToken(identity, undefined, principal?.jti);
    } catch (error) {
      logRateLimitFailure("Global rate limiter", error);
      return true;
    }

    if (principal) {
      authContext.blacklistChecked = true;
      authContext.revoked = result.revoked;
      if (!result.revoked) {
        request.user = principal.user;
        request.token = token ?? undefined;
      }
    }

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.retryAfterMs / 1_000),
      );
      context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header("Retry-After", String(retryAfterSeconds));
      throw apiHttpException(
        "Too many requests, please try again later",
        {
          code: "MANY_REQUESTS",
          time_left_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    return true;
  }
}

@Injectable()
export class SensitiveAuthRateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const clientIp = request.ip ?? request.socket.remoteAddress;
    if (!clientIp) {
      throw apiHttpException(
        "Rate limiter temporarily unavailable",
        { code: "RATE_LIMIT_UNAVAILABLE" },
        503,
      );
    }

    let result;
    try {
      result = await consumeSensitiveAuthRateLimitToken(`ip:${clientIp}`);
    } catch (error) {
      logRateLimitFailure("Sensitive auth rate limiter", error);
      throw apiHttpException(
        "Rate limiter temporarily unavailable",
        { code: "RATE_LIMIT_UNAVAILABLE" },
        503,
      );
    }

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.retryAfterMs / 1_000),
      );
      context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header("Retry-After", String(retryAfterSeconds));
      throw apiHttpException(
        "Too many requests, please try again later",
        {
          code: "MANY_REQUESTS",
          time_left_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    return true;
  }
}

@Injectable()
export class HeavyRateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequest(context);
    const principal = request.authContext?.principal;
    const clientIp = request.ip ?? request.socket.remoteAddress;
    const identity = request.user?.id ?? principal?.user.id;
    const rateLimitIdentity = identity
      ? `user:${identity}`
      : clientIp
        ? `ip:${clientIp}`
        : undefined;

    // The existing heavy limiter is fail-open when identity/Redis is
    // unavailable; keep the same behavior for the Nest routes.
    if (!rateLimitIdentity) return true;

    let result;
    try {
      result = await consumeHeavyRateLimitToken(rateLimitIdentity);
    } catch (error) {
      logRateLimitFailure("Heavy rate limiter", error);
      return true;
    }

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.retryAfterMs / 1_000),
      );
      context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header("Retry-After", String(retryAfterSeconds));
      throw apiHttpException(
        "Too many requests, please try again later",
        {
          code: "MANY_REQUESTS",
          time_left_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    return true;
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequest(context);
    const authContext = request.authContext;

    if (authContext?.blacklistChecked) {
      if (authContext.principal && !authContext.revoked && authContext.token) {
        request.user = authContext.principal.user;
        request.token = authContext.token;
      }
      return true;
    }

    // Keep this fallback if the global limiter failed open before it could
    // confirm the token's blacklist status.
    const token = authContext?.token ?? getAccessToken(request);
    const user = token ? await apiAuthService.getProfile(token) : false;
    if (user) {
      request.user = user;
      request.token = token ?? undefined;
    }
    if (authContext) {
      authContext.blacklistChecked = true;
      authContext.revoked = !user && authContext.principal !== null;
    }
    return true;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequest(context);
    const authContext = request.authContext;

    if (authContext?.blacklistChecked) {
      if (authContext.principal && !authContext.revoked && authContext.token) {
        request.user = authContext.principal.user;
        request.token = authContext.token;
        return true;
      }

      throw apiHttpException(
        "Invalid credentials or missing token",
        {},
        401,
      );
    }

    // Preserve authMiddleware's fallback when Redis could not answer the
    // combined rate-limit/blacklist pipeline.
    const token = authContext?.token ?? getAccessToken(request);
    const user = token ? await apiAuthService.getProfile(token) : false;
    if (!user) {
      if (authContext) {
        authContext.blacklistChecked = true;
        authContext.revoked = authContext.principal !== null;
      }
      throw apiHttpException(
        "Invalid credentials or missing token",
        {},
        401,
      );
    }

    request.user = user;
    request.token = token ?? undefined;
    if (authContext) {
      authContext.blacklistChecked = true;
      authContext.revoked = false;
    }
    return true;
  }
}
