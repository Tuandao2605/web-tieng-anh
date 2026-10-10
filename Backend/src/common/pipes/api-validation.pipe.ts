import {
  HttpStatus,
  ValidationPipe,
  type ValidationError,
} from "@nestjs/common";
import { apiHttpException } from "../exceptions/api-http-exception";

const collectMessages = (
  error: ValidationError,
  rootProperty: string,
  issues: { path: string; message: string }[],
) => {
  for (const message of Object.values(error.constraints ?? {})) {
    issues.push({ path: rootProperty, message });
  }
  for (const child of error.children ?? []) {
    collectMessages(child, rootProperty, issues);
  }
};

export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      forbidUnknownValues: false,
      stopAtFirstError: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const issues: { path: string; message: string }[] = [];
        for (const error of errors) {
          collectMessages(error, error.property, issues);
        }
        return apiHttpException(
          "Validated Failed",
          issues,
          HttpStatus.BAD_REQUEST,
        );
      },
    });
  }
}
