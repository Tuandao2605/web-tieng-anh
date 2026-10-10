import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hasErrorCode } from "../../errors/app.error";
import type { AuthenticatedUser } from "../../types/auth";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validator";
import { ApiMessage } from "../../common/decorators/api-message.decorator";
import { apiHttpException } from "../../common/exceptions/api-http-exception";
import {
  ApiRateLimitGuard,
  JwtAuthGuard,
  SensitiveAuthRateLimitGuard,
} from "../../common/guards/api.guards";
import { API_AUTH_SERVICE, AUTH_SERVICE } from "./auth.tokens";
import type { ApiAuthService, AuthService } from "./auth.tokens";

type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
  token?: string;
};

const validationException = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  apiHttpException(
    "Validated Failed",
    issues.map((issue) => ({ path: issue.path[1], message: issue.message })),
    HttpStatus.BAD_REQUEST,
  );

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("name" in error && error.name === "AbortError") ||
    ("code" in error && error.code === "ABORT_ERR"));

const createAbortSignal = (reply: FastifyReply) => {
  const controller = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once("close", onClose);
  return {
    signal: controller.signal,
    cleanup: () => reply.raw.off("close", onClose),
  };
};

@Controller("api/v1/auth")
@UseGuards(ApiRateLimitGuard)
export class AuthController {
  constructor(
    @Inject(API_AUTH_SERVICE) private readonly apiAuth: ApiAuthService,
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
  ) {}

  @Post("login")
  @UseGuards(SensitiveAuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Login Success")
  async login(@Body() body: unknown) {
    const parsed = await loginSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    const token = await this.apiAuth.login(parsed.data.body);
    if (!token) {
      throw apiHttpException(
        "Email hoac mat khau khong chinh xac",
        {},
        HttpStatus.BAD_REQUEST,
      );
    }
    return token;
  }

  @Post("register")
  @UseGuards(SensitiveAuthRateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiMessage("Register Success")
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    let parsed: Awaited<ReturnType<typeof registerSchema.safeParseAsync>>;
    try {
      parsed = await registerSchema.safeParseAsync({ body });
    } catch {
      throw apiHttpException(
        "Server Error",
        {},
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!parsed.success) throw validationException(parsed.error.issues);
    if (await this.auth.existingEmail(parsed.data.body.email)) {
      throw validationException([
        { path: ["body", "email"], message: "Email da ton tai" },
      ]);
    }

    const abort = createAbortSignal(reply);
    try {
      const user = await this.auth.register(parsed.data.body, abort.signal);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    } catch (error) {
      if (abort.signal.aborted || isAbortError(error)) return;
      if (hasErrorCode(error, "P2002")) {
        throw apiHttpException(
          "Email already exists",
          {},
          HttpStatus.CONFLICT,
        );
      }
      throw apiHttpException(
        error instanceof Error ? error.message : "Register failed",
        {},
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      abort.cleanup();
    }
  }

  @Post("forgot-password")
  @UseGuards(SensitiveAuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi.")
  async forgotPassword(@Body() body: unknown) {
    const parsed = await forgotPasswordSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      await this.apiAuth.requestPasswordReset(parsed.data.body.email);
    } catch (error) {
      // Keep the generic response to prevent email enumeration and SMTP leaks.
      console.error("Password reset email failed", error);
    }
    return {};
  }

  @Post("reset-password")
  @UseGuards(SensitiveAuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Đặt lại mật khẩu thành công")
  async resetPassword(@Body() body: unknown) {
    const parsed = await resetPasswordSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    let updated: boolean | void;
    try {
      updated = await this.apiAuth.resetPassword(
        parsed.data.body.token,
        parsed.data.body.password,
      );
    } catch {
      throw apiHttpException(
        "Không thể đặt lại mật khẩu",
        {},
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!updated) {
      throw apiHttpException(
        "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
        {},
        HttpStatus.BAD_REQUEST,
      );
    }
    return {};
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Get user profile success")
  profile(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  @Delete("logout")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Logout success")
  async logout(@Req() request: AuthenticatedRequest) {
    const token = request.token;
    const userId = request.user?.id;
    if (!token || !userId) {
      throw new HttpException(
        { status: "error", message: "Thiếu thông tin token" },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await this.apiAuth.logout(token, userId);
    } catch {
      throw new HttpException(
        { status: "error", message: "Lỗi server khi đăng xuất" },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return {};
  }

  @Post("refresh-token")
  @UseGuards(SensitiveAuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Get new token success")
  async refreshToken(@Body() body: { refreshToken?: string } | null) {
    const refreshToken = body?.refreshToken;
    if (!refreshToken) {
      throw apiHttpException(
        "Provide refresh Token",
        {},
        HttpStatus.BAD_REQUEST,
      );
    }

    const newToken = await this.apiAuth.refreshToken(refreshToken);
    if (!newToken) {
      throw apiHttpException(
        "Invalid or expired refresh token",
        {},
        HttpStatus.UNAUTHORIZED,
      );
    }
    return newToken;
  }
}
