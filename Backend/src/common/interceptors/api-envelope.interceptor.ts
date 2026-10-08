import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, Observable } from "rxjs";
import { API_MESSAGE_METADATA } from "../decorators/api-message.decorator";

type ApiEnvelope<T> = {
  obj: {
    success: true;
    data: T;
    message: string;
  };
};

const isApiEnvelope = (value: unknown): value is ApiEnvelope<unknown> => {
  if (typeof value !== "object" || value === null || !("obj" in value)) {
    return false;
  }

  const obj = value.obj;
  return (
    typeof obj === "object" &&
    obj !== null &&
    "success" in obj &&
    obj.success === true &&
    "data" in obj &&
    "message" in obj &&
    typeof obj.message === "string"
  );
};

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const message =
      this.reflector.get<string>(API_MESSAGE_METADATA, context.getHandler()) ??
      "Request successful";

    return next.handle().pipe(
      map((data: unknown) =>
        isApiEnvelope(data)
          ? data
          : ({ obj: { success: true, data, message } } satisfies ApiEnvelope<
              unknown
            >),
      ),
    );
  }
}
