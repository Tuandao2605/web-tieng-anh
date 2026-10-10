import { Transform } from "class-transformer";
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { IsRequiredEmail } from "../../../common/validation/email.decorator";

export class RegisterDto {
  @IsString({ message: "Ten bat buoc phai nhap" })
  @MinLength(1, { message: "Ten bat buoc phai nhap" })
  name!: string;

  @IsRequiredEmail("Email bat buoc phai nhap", "Email khong dung dinh dang")
  email!: string;

  @IsString({ message: "Mat khau phai tu 6 ki tu" })
  @MinLength(6, { message: "Mat khau phai tu 6 ki tu" })
  password!: string;
}

export class LoginDto {
  @IsRequiredEmail("Email bat buoc phai nhap", "Email khong dung dinh dang")
  email!: string;

  @IsString({ message: "Mat khau phai tu 6 ki tu" })
  @MinLength(6, { message: "Mat khau phai tu 6 ki tu" })
  password!: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Email không đúng định dạng" })
  email!: string;
}

export class ResetPasswordDto {
  @IsString({ message: "Token không hợp lệ" })
  @MinLength(32, { message: "Token không hợp lệ" })
  token!: string;

  @IsString({ message: "Mật khẩu phải có ít nhất 6 ký tự" })
  @MinLength(6, { message: "Mật khẩu phải có ít nhất 6 ký tự" })
  @MaxLength(128)
  password!: string;
}
