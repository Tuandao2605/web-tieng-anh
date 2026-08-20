import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";
const developmentSessionSecret = "local-development-session-secret";
const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
const configuredSessionTtlMs = Number(process.env.SESSION_TTL_MS);

if (
  isProduction &&
  (!configuredSessionSecret ||
    configuredSessionSecret.length < 32 ||
    configuredSessionSecret.includes("change-me"))
) {
  throw new Error(
    "SESSION_SECRET must be set to a strong value of at least 32 characters in production.",
  );
}

const developmentOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
];
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction && configuredOrigins.length === 0) {
  throw new Error("CORS_ALLOWED_ORIGINS must be configured in production.");
}

export const runtimeConfig = {
  isProduction,
  port: Number(process.env.PORT) || 3000,
  sessionSecret: configuredSessionSecret || developmentSessionSecret,
  sessionCookieName: process.env.SESSION_COOKIE_NAME?.trim() || "web.sid",
  sessionTtlMs:
    Number.isFinite(configuredSessionTtlMs) && configuredSessionTtlMs > 0
      ? configuredSessionTtlMs
      : 8 * 60 * 60 * 1000,
  allowedOrigins:
    configuredOrigins.length > 0 ? configuredOrigins : developmentOrigins,
} as const;
