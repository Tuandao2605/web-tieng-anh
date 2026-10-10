import "reflect-metadata";
import { HttpStatus } from "@nestjs/common";
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
import { ApiEnvelopeInterceptor } from "./common/interceptors/api-envelope.interceptor";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { ApiValidationPipe } from "./common/pipes/api-validation.pipe";
import { AppModule } from "./app.module";
import { REDIS_CLIENT } from "./config/infrastructure.tokens";
import { startPerformanceDiagnostics } from "./common/performance-diagnostics";

const configuredNestPort = Number(process.env.NEST_PORT);
const nestPort =
  Number.isInteger(configuredNestPort) && configuredNestPort > 0
    ? configuredNestPort
    : Number(process.env.PORT) > 0
      ? Number(process.env.PORT)
      : 3000;
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
    await app.register(fastifyCookie, { secret: runtimeConfig.sessionSecret });
    await app.register(fastifyCors, {
      origin: (origin, callback) => {
        if (!origin || runtimeConfig.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        const error = Object.assign(
          new Error("Origin is not allowed by CORS"),
          { status: HttpStatus.FORBIDDEN },
        );
        callback(error, false);
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
    app.useGlobalPipes(new ApiValidationPipe());
    app.enableShutdownHooks();

    await app.listen(nestPort, "0.0.0.0");
    const httpServer = app.getHttpServer();
    httpServer.keepAliveTimeout = runtimeConfig.httpKeepAliveTimeoutMs;
    httpServer.headersTimeout = runtimeConfig.httpHeadersTimeoutMs;
    if (process.env.PERFORMANCE_DIAGNOSTICS === "true") {
      const configuredDiagnosticsInterval = Number(
        process.env.PERFORMANCE_DIAGNOSTICS_INTERVAL_MS,
      );
      const diagnosticsIntervalMs =
        Number.isInteger(configuredDiagnosticsInterval) &&
        configuredDiagnosticsInterval >= 1_000
          ? configuredDiagnosticsInterval
          : 10_000;
      const stopDiagnostics = startPerformanceDiagnostics(
        app.get(REDIS_CLIENT),
        diagnosticsIntervalMs,
      );
      httpServer.once("close", stopDiagnostics);
    }
    app
      .getHttpAdapter()
      .getInstance()
      .log.info(`Nest Fastify application listening on port ${nestPort}`);
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
