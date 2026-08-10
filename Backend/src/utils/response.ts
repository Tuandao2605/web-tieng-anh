import { Response } from "express";
type successResponse<T, A> = {
  success: boolean;
  data: T;
  message: string;
  meta?: A;
};
export const successResponse = <T, A>(
  response: Response,
  data: T,
  message: string,
  statusCode: number = 200,
  meta: A | null = null,
) => {
  const obj: successResponse<T, A> = {
    success: true,
    data,
    message,
  };
  if (meta) {
    obj.meta = meta;
  }
  return response.status(statusCode).json({
    obj,
  });
};

export const errorResponse = <T>(
  response: Response,
  message: string,
  error: T,
  statusCode: number = 500,
) => {
  return response.status(statusCode).json({
    success: false,
    error,
    message,
  });
};
