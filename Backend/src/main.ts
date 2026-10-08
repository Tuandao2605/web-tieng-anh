import "reflect-metadata";
import querystring from "node:querystring";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import type { FastifyServerOptions } from "fastify";
import { runtimeConfig } from "./config/runtime";
import { startSocketServer } from "./web-socket/socket-server";
import { ApiEnvelopeInterceptor } from "./common/interceptors/api-envelope.interceptor";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { AppModule } from "./app.module";

const configuredNestPort = Number(process.env.NEST_PORT);
const nestPort =
  Number.isInteger(configuredNestPort) && configuredNestPort > 0
    ? configuredNestPort
    : Number(process.env.PORT) > 0
      ? Number(process.env.PORT)
      : 3001;
const trustProxySetting = process.env.TRUST_PROXY?.trim();
if (trustProxySetting === "true") {
  throw new Error(
    "TRUST_PROXY=true trusts every proxy. Configure trusted IPs/CIDRs or a fixed hop count instead.",
  );
}
const trustProxy: FastifyServerOptions["trustProxy"] = (() => {
  if (!trustProxySetting || trustProxySetting === "false") return false;
  if (/^\d+$/.test(trustProxySetting)) {
    const trustedHops = Number(trustProxySetting);
    return (_address, hop) => hop < trustedHops;
  }
  return trustProxySetting.split(",").map((entry) => entry.trim());
})();

const bootstrap = async () => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 1_000_000,
      logger: process.env.NODE_ENV === "development",
      trustProxy,
      routerOptions: {
        caseSensitive: false,
        ignoreTrailingSlash: true,
      },
    }),
  );

  try {
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => done(null, querystring.parse(body.toString())),
    );

    await app.register(fastifyCookie, { secret: runtimeConfig.sessionSecret });
    await app.register(fastifyCors, {
      origin: (origin, callback) => {
        if (!origin || runtimeConfig.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin is not allowed by CORS"), false);
      },
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 86_400,
    });
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          upgradeInsecureRequests: runtimeConfig.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: runtimeConfig.isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
    });

    app.useGlobalInterceptors(app.get(ApiEnvelopeInterceptor));
    app.useGlobalFilters(app.get(ApiExceptionFilter));
    app.enableShutdownHooks();

    await app.listen(nestPort, "0.0.0.0");
    const httpServer = app.getHttpServer();
    httpServer.keepAliveTimeout = runtimeConfig.httpKeepAliveTimeoutMs;
    httpServer.headersTimeout = runtimeConfig.httpHeadersTimeoutMs;
    startSocketServer();
    app.getHttpAdapter().getInstance().log.info(
      `Nest Fastify application listening on port ${nestPort}`,
    );
  } catch (error) {
    await app.close().catch((closeError: unknown) => {
      console.error("Failed to close Nest after bootstrap error", closeError);
    });
    throw error;
  }
};

void bootstrap().catch((error: unknown) => {
  console.error("Unable to start Nest Fastify API", error);
  process.exitCode = 1;
});
