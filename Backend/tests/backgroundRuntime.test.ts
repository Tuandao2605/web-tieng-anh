import assert from "node:assert/strict";
import test from "node:test";
import { assertBackgroundWorkerRole } from "../src/utils/backgroundRuntime";

test("background jobs only start in the dedicated worker process", (t) => {
  const previousRole = process.env.BACKGROUND_RUNTIME_ROLE;
  t.after(() => {
    if (previousRole === undefined) {
      delete process.env.BACKGROUND_RUNTIME_ROLE;
    } else {
      process.env.BACKGROUND_RUNTIME_ROLE = previousRole;
    }
  });

  process.env.BACKGROUND_RUNTIME_ROLE = "web";
  assert.throws(assertBackgroundWorkerRole, /BACKGROUND_RUNTIME_ROLE=worker/);

  process.env.BACKGROUND_RUNTIME_ROLE = "api";
  assert.throws(assertBackgroundWorkerRole, /BACKGROUND_RUNTIME_ROLE=worker/);

  process.env.BACKGROUND_RUNTIME_ROLE = "worker";
  assert.doesNotThrow(assertBackgroundWorkerRole);
});
