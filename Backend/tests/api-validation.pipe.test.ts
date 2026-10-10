import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { ApiValidationPipe } from "../src/common/pipes/api-validation.pipe";
import { LoginDto } from "../src/modules/auth/dto/auth.dto";

test("API validation pipe keeps the established validation error envelope", async () => {
  const pipe = new ApiValidationPipe();
  await assert.rejects(
    pipe.transform(
      { email: "", password: "long-enough" },
      { type: "body", metatype: LoginDto, data: "" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 400);
      const response = error.getResponse();
      assert.deepEqual(response, {
        success: false,
        error: [{ path: "email", message: "Email bat buoc phai nhap" }],
        message: "Validated Failed",
      });
      return true;
    },
  );
});
