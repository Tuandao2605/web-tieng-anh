import { ValidateIf } from "class-validator";
import { IsString, MinLength } from "class-validator";
import { IsRequiredEmail } from "../../../common/validation/email.decorator";

export class UpdateUserDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: "Ten khong duoc de trong" })
  @MinLength(1, { message: "Ten khong duoc de trong" })
  name?: string | undefined;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsRequiredEmail("Email khong duoc de trong", "Email khong dung dinh dang")
  email?: string | undefined;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: "Mat khau khong duoc de trong" })
  @MinLength(1, { message: "Mat khau khong duoc de trong" })
  password?: string | undefined;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  phone?: string | undefined;
}
