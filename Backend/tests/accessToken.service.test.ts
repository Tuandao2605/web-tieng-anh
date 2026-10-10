import assert from "node:assert/strict";
import test from "node:test";

test("shared access-token L1 returns one verified principal", async () => {
  process.env.JWT_SECRET = "access-token-cache-test-secret-at-least-32-chars";
  process.env.JWT_EXPIRE = "15m";

  const { generateToken } = await import("../src/utils/jwt");
  const { AccessTokenService } =
    await import("../src/common/services/access-token.service");
  const accessTokens = new AccessTokenService();
  const token = generateToken({
    id: "64b000000000000000000099",
    email: "shared-cache@example.com",
    name: "Shared Cache",
    status: true,
  });

  const first = accessTokens.verifyCached(token);
  const second = accessTokens.verifyCached(token);

  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(second.user, first.user);
  assert.equal(second.jti, first.jti);
  assert.equal(second.expiresAt, first.expiresAt);
});

test("shared access-token L1 never caches malformed tokens", async () => {
  const { AccessTokenService } =
    await import("../src/common/services/access-token.service");
  const accessTokens = new AccessTokenService();

  assert.equal(accessTokens.extractBearer(undefined), null);
  assert.equal(accessTokens.extractBearer("Basic abc"), null);
  assert.equal(accessTokens.extractBearer("Bearer one.two"), null);
  assert.equal(
    accessTokens.extractBearer("Bearer one.two.bad+character"),
    null,
  );
  assert.equal(
    accessTokens.extractBearer(`Bearer ${"a".repeat(4_090)}`),
    null,
  );
  assert.equal(accessTokens.isPlausible("a.b.c"), false);
  assert.equal(accessTokens.verifyCached("malformed-token"), null);
  assert.equal(accessTokens.verifyCached("malformed-token"), null);
});

test("fast JWT checks accept the shape of a real generated access token", async () => {
  const { generateToken } = await import("../src/utils/jwt");
  const { AccessTokenService } =
    await import("../src/common/services/access-token.service");
  const accessTokens = new AccessTokenService();
  const token = generateToken({
    id: "64b000000000000000000098",
    email: "jwt-shape@example.com",
    name: "JWT Shape",
    status: true,
  });

  assert.equal(accessTokens.isPlausible(token), true);
  assert.equal(accessTokens.extractBearer(`Bearer ${token}`), token);
});
