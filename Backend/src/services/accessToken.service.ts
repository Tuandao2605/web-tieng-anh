import type { JwtPayload } from "jsonwebtoken";
import type {
  AuthenticatedUser,
  JwtPayLoad,
  VerifiedAccessToken,
} from "../types/auth";
import { verifyToken } from "../utils/jwt";

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CACHE_TTL_MS = positiveNumberFromEnv(
  process.env.JWT_L1_CACHE_TTL_MS,
  60_000,
);
const CACHE_MAX_ENTRIES = positiveNumberFromEnv(
  process.env.JWT_L1_CACHE_MAX_ENTRIES,
  10_000,
);
const AUTHORIZATION_HEADER_MAX_BYTES = positiveNumberFromEnv(
  process.env.AUTHORIZATION_HEADER_MAX_BYTES,
  4_096,
);
const JWT_MIN_LENGTH = positiveNumberFromEnv(
  process.env.JWT_MIN_TOKEN_LENGTH,
  64,
);
const JWT_MAX_LENGTH = Math.min(
  positiveNumberFromEnv(process.env.JWT_MAX_TOKEN_LENGTH, 4_089),
  AUTHORIZATION_HEADER_MAX_BYTES,
);
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type AccessTokenCacheEntry = VerifiedAccessToken & {
  cacheExpiresAt: number;
};

// Positive-only bounded LRU. Invalid tokens are attacker-controlled and are
// deliberately not cached, while Redis remains authoritative for revocation.
const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

const readCache = (token: string): VerifiedAccessToken | null => {
  const entry = accessTokenCache.get(token);
  if (!entry) return null;
  if (entry.cacheExpiresAt <= Date.now() || entry.expiresAt <= Date.now()) {
    accessTokenCache.delete(token);
    return null;
  }

  accessTokenCache.delete(token);
  accessTokenCache.set(token, entry);
  return entry;
};

const writeCache = (token: string, principal: VerifiedAccessToken) => {
  const now = Date.now();
  const cacheExpiresAt = Math.min(now + CACHE_TTL_MS, principal.expiresAt);
  if (cacheExpiresAt <= now) return;

  accessTokenCache.delete(token);
  while (accessTokenCache.size >= CACHE_MAX_ENTRIES) {
    const oldestToken = accessTokenCache.keys().next().value as
      | string
      | undefined;
    if (!oldestToken) break;
    accessTokenCache.delete(oldestToken);
  }
  accessTokenCache.set(token, { ...principal, cacheExpiresAt });
};

export const isPlausibleAccessToken = (token: string) =>
  token.length >= JWT_MIN_LENGTH &&
  token.length <= JWT_MAX_LENGTH &&
  JWT_SHAPE.test(token);

export const extractBearerToken = (authorization: string | undefined) => {
  if (
    !authorization ||
    Buffer.byteLength(authorization, "utf8") > AUTHORIZATION_HEADER_MAX_BYTES
  ) {
    return null;
  }

  const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  return token && isPlausibleAccessToken(token) ? token : null;
};

export const verifyAccessTokenCached = (
  token: string,
): VerifiedAccessToken | null => {
  if (!isPlausibleAccessToken(token)) return null;

  const cached = readCache(token);
  if (cached) return cached;

  const decoded = verifyToken(token);
  if (!decoded || typeof decoded === "string") return null;

  const { id, email, name, status, jti, exp } = decoded as JwtPayload &
    Partial<JwtPayLoad> & { jti?: string };
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof email !== "string" ||
    email.length === 0 ||
    typeof jti !== "string" ||
    jti.length === 0 ||
    status === false ||
    typeof exp !== "number" ||
    exp * 1_000 <= Date.now()
  ) {
    return null;
  }

  const user: AuthenticatedUser = {
    id,
    email,
    name: typeof name === "string" ? name : null,
    status: status ?? true,
  };
  const principal = { user, jti, expiresAt: exp * 1_000 };
  writeCache(token, principal);
  return principal;
};

export const evictAccessToken = (token: string) => {
  accessTokenCache.delete(token);
};
