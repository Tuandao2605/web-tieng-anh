export class UpdatedError extends Error {
  cause?: any;
  status: number;

  constructor(message: string, status = 500, cause?: any) {
    super(message);
    this.status = status;
    this.cause = cause;

    // 🔥 fix prototype (quan trọng trong TS)
    Object.setPrototypeOf(this, UpdatedError.prototype);
  }
}
