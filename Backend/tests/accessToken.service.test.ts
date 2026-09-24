import assert from "node:assert/strict";
import test from "node:test";

test("shared access-token L1 returns one verified principal", async () => {
  process.env.JWT_SECRET = "access-token-cache-test-secret-at-least-32-chars";
  process.env.JWT_EXPIRE = "15m";

  const { generateToken } = await import("../src/utils/jwt");
  const { verifyAccessTokenCached } =
    await import("../src/services/accessToken.service");
  const token = generateToken({
    id: "64b000000000000000000099",
    email: "shared-cache@example.com",
    name: "Shared Cache",
    status: true,
  });

  const first = verifyAccessTokenCached(token);
  const second = verifyAccessTokenCached(token);

  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(second.user, first.user);
  assert.equal(second.jti, first.jti);
  assert.equal(second.expiresAt, first.expiresAt);
});

test("shared access-token L1 never caches malformed tokens", async () => {
  const {
    extractBearerToken,
    isPlausibleAccessToken,
    verifyAccessTokenCached,
  } =
    await import("../src/services/accessToken.service");

  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer one.two"), null);
  assert.equal(extractBearerToken("Bearer one.two.bad+character"), null);
  assert.equal(extractBearerToken(`Bearer ${"a".repeat(4_090)}`), null);
  assert.equal(isPlausibleAccessToken("a.b.c"), false);
  assert.equal(verifyAccessTokenCached("malformed-token"), null);
  assert.equal(verifyAccessTokenCached("malformed-token"), null);
});

test("fast JWT checks accept the shape of a real generated access token", async () => {
  const { generateToken } = await import("../src/utils/jwt");
  const { extractBearerToken, isPlausibleAccessToken } =
    await import("../src/services/accessToken.service");
  const token = generateToken({
    id: "64b000000000000000000098",
    email: "jwt-shape@example.com",
    name: "JWT Shape",
    status: true,
  });

  assert.equal(isPlausibleAccessToken(token), true);
  assert.equal(extractBearerToken(`Bearer ${token}`), token);
});
