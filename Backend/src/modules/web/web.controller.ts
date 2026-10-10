import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import ejs from "ejs";
import moment from "moment";
import { emailQueue } from "../../queues";
import { JOB_DELAY, JOB_NAME } from "../../constants/queue.constants";
import type { RegisterData } from "../../types/auth";
import { registerSchema } from "../auth/auth.validator";
import { AUTH_SERVICE } from "../auth/auth.tokens";
import type { AuthService } from "../auth/auth.tokens";
import { WebCsrfGuard, WebSessionGuard, type WebRequest } from "./web.guards";
import { WebSessionService } from "./web-session.service";

const viewDirectory = join(__dirname, "../../views");
const publicDirectory = join(__dirname, "../../../public");

const renderView = (view: string, locals: Record<string, unknown>) =>
  ejs.renderFile(join(viewDirectory, `${view}.ejs`), locals);

const renderPage = async (view: string, locals: Record<string, unknown>) => {
  const body = await renderView(view, locals);
  return renderView("layouts/main.layouts", {
    ...locals,
    body,
    style: "",
    script: "",
  });
};

const flashMessages = async (
  request: WebRequest,
  type: string,
  webSessions: WebSessionService,
) => {
  const messages = request.raw.flash(type);
  await webSessions.save(request.raw.session);
  return messages;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Controller()
export class WebController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    private readonly webSessions: WebSessionService,
  ) {}

  // The previous static middleware served public/index.html before the EJS
  // home route. Preserve that externally visible behavior in Fastify.
  @Get()
  @HttpCode(HttpStatus.OK)
  async home(@Res() reply: FastifyReply) {
    const html = await readFile(join(publicDirectory, "index.html"));
    return reply.type("text/html; charset=utf-8").send(html);
  }

  @Get("index.html")
  @HttpCode(HttpStatus.OK)
  async indexFile(@Res() reply: FastifyReply) {
    const html = await readFile(join(publicDirectory, "index.html"));
    return reply.type("text/html; charset=utf-8").send(html);
  }

  @Get("assets/style.css")
  async style(@Res() reply: FastifyReply) {
    const asset = await readFile(join(publicDirectory, "assets/style.css"));
    return reply.type("text/css; charset=utf-8").send(asset);
  }

  @Get("assets/scripts.js")
  async scripts(@Res() reply: FastifyReply) {
    const asset = await readFile(join(publicDirectory, "assets/scripts.js"));
    return reply.type("text/javascript; charset=utf-8").send(asset);
  }

  @Get("auth/login")
  @UseGuards(WebSessionGuard)
  async loginPage(@Req() request: WebRequest, @Res() reply: FastifyReply) {
    const message = await flashMessages(request, "message", this.webSessions);
    const html = await renderView("auth/login", {
      csrfToken: request.csrfToken,
      message,
    });
    return reply.type("text/html; charset=utf-8").send(html);
  }

  @Get("auth/register")
  @UseGuards(WebSessionGuard)
  async registerPage(@Req() request: WebRequest, @Res() reply: FastifyReply) {
    const flashedErrors = await flashMessages(
      request,
      "errors",
      this.webSessions,
    );
    let errors: Record<string, unknown> = {};
    try {
      errors = JSON.parse(flashedErrors[0] ?? "{}") as Record<string, unknown>;
    } catch {
      // Ignore malformed or stale flash data and render an empty error map.
    }
    const html = await renderView("auth/register", {
      csrfToken: request.csrfToken,
      errors,
    });
    return reply.type("text/html; charset=utf-8").send(html);
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.FOUND)
  @UseGuards(WebSessionGuard, WebCsrfGuard)
  async handleLogin(
    @Req() request: WebRequest,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ) {
    const credentials = asRecord(body);
    const email =
      typeof credentials.email === "string" ? credentials.email : "";
    const password =
      typeof credentials.password === "string" ? credentials.password : "";
    const loggedIn = await this.auth.login({ email, password }, request.raw);

    if (!loggedIn) {
      request.raw.flash("message", "Email hoac mat khau khong chinh xac");
      await this.webSessions.save(request.raw.session);
      return reply.redirect("/auth/login");
    }
    return reply.redirect("/");
  }

  @Post("auth/register")
  @UseGuards(WebSessionGuard, WebCsrfGuard)
  async handleRegister(
    @Req() request: WebRequest,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ) {
    const parsed = await registerSchema.safeParseAsync({ body });
    if (!parsed.success) {
      const errors = Object.fromEntries(
        parsed.error.issues.map(
          (issue: { path: PropertyKey[]; message: string }) => [
            issue.path[1],
            issue.message,
          ],
        ),
      );
      request.raw.flash("errors", JSON.stringify(errors));
      await this.webSessions.save(request.raw.session);
      const referer = request.headers.referer;
      const redirectTo =
        typeof referer === "string" && referer.startsWith("/") ? referer : "/";
      return reply.redirect(redirectTo);
    }

    if (await this.auth.existingEmail(parsed.data.body.email)) {
      request.raw.flash(
        "errors",
        JSON.stringify({ email: "Email da ton tai" }),
      );
      await this.webSessions.save(request.raw.session);
      const referer = request.headers.referer;
      const redirectTo =
        typeof referer === "string" && referer.startsWith("/") ? referer : "/";
      return reply.redirect(redirectTo);
    }

    await this.auth.register(parsed.data.body as RegisterData);
    request.raw.flash("message", "Dang ky tai khoan thanh cong");
    await this.webSessions.save(request.raw.session);
    return reply.redirect("/auth/login");
  }

  @Get("auth/me")
  @UseGuards(WebSessionGuard)
  async profilePage(@Req() request: WebRequest, @Res() reply: FastifyReply) {
    if (!request.user) return reply.redirect("/auth/login");
    const html = await renderPage("auth/profile", {
      csrfToken: request.csrfToken,
      user: request.user,
      moment,
    });
    return reply.type("text/html; charset=utf-8").send(html);
  }

  @Post("auth/logout")
  @UseGuards(WebSessionGuard, WebCsrfGuard)
  async logout(@Req() request: WebRequest, @Res() reply: FastifyReply) {
    if (!request.user) return reply.redirect("/auth/login");

    await new Promise<void>((resolve, reject) =>
      request.raw.session.destroy((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    return reply.redirect("/auth/login");
  }

  @Get("test-redis")
  @UseGuards(WebSessionGuard)
  @HttpCode(HttpStatus.OK)
  testRedis(@Res() reply: FastifyReply) {
    return reply.send({});
  }

  @Get("test-mq")
  @UseGuards(WebSessionGuard)
  @HttpCode(HttpStatus.OK)
  async testMq(@Res() reply: FastifyReply) {
    await emailQueue.add(
      JOB_NAME.EMAIL.FORGOT_PASSWORD,
      {
        subject: "Ban can lay lai mat khau",
        message: "Chao ban, abc",
        to: "tuan5amtb@gmail.com",
      },
      {
        removeOnComplete: true,
        removeOnFail: true,
        delay: JOB_DELAY,
        attempts: 3,
        backoff: { type: "fixed", delay: JOB_DELAY },
      },
    );
    return reply.send({});
  }
}
