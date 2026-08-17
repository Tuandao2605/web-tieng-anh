import { z } from "zod";
import { authService } from "../services/auth.service";
export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(1, {
      message: "Ten bat buoc phai nhap",
    }),
    email: z
      .string()
      .min(1, {
        message: "Email bat buoc phai nhap",
      })
      .pipe(
        z.email({
          message: "Email khong dung dinh dang",
        }),
      )
      .refine(
        async (email: string) => {
          const isExisting = await authService.existingEmail(email);
          return !isExisting;
        },
        {
          message: "Email da ton tai",
        },
      ),
    password: z.string().min(6, {
      message: "Mat khau phai tu 6 ki tu",
    }),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, {
        message: "Email bat buoc phai nhap",
      })
      .pipe(
        z.email({
          message: "Email khong dung dinh dang",
        }),
      ),
    password: z.string().min(6, {
      message: "Mat khau phai tu 6 ki tu",
    }),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Email không đúng định dạng")),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32, "Token không hợp lệ"),
    password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự").max(128),
  }),
});
