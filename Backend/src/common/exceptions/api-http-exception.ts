import { HttpException } from "@nestjs/common";

/** Creates an API error body compatible with the existing response contract. */
export const apiHttpException = (
  message: string,
  error: unknown,
  status: number,
) => new HttpException({ success: false, error, message }, status);
