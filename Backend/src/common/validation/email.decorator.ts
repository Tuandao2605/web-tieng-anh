import {
  isEmail,
  registerDecorator,
  type ValidationArguments,
} from "class-validator";

export const IsRequiredEmail = (
  requiredMessage: string,
  invalidMessage: string,
): PropertyDecorator =>
  (target, propertyName) => {
    registerDecorator({
      name: "isRequiredEmail",
      target: target.constructor,
      propertyName: propertyName.toString(),
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && value.length > 0 && isEmail(value);
        },
        defaultMessage(args?: ValidationArguments) {
          const value: unknown = args?.value;
          return typeof value !== "string" || value.length === 0
            ? requiredMessage
            : invalidMessage;
        },
      },
    });
  };
