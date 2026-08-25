export class UpdatedError extends Error {
  cause?: unknown;
  status: number;

  constructor(message: string, status = 500, cause?: unknown) {
    super(message);
    this.status = status;
    this.cause = cause;

    // 🔥 fix prototype (quan trọng trong TS)
    Object.setPrototypeOf(this, UpdatedError.prototype);
  }
}

export const hasErrorCode = (
  error: unknown,
  code: string,
): error is { code: string } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === code;
