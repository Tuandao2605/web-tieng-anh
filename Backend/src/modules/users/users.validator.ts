import * as z from "zod";
export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(1, {
      message: "Ten khong duoc de trong",
    }),
    email: z
      .string()
      .min(1, {
        message: "Email khong duoc de trong",
      })
      .pipe(
        z.email({
          message: "Email khong dung dinh dang",
        }),
      ),

    password: z.string().min(1, {
      message: "Mat khau khong duoc de trong",
    }),
    phone: z.string().optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().min(1, {
      message: "User id is required",
    }),
  }),
  body: z.object({
    name: z
      .string()
      .min(1, {
        message: "Ten khong duoc de trong",
      })
      .optional(),
    email: z
      .string()
      .min(1, {
        message: "Email khong duoc de trong",
      })
      .pipe(
        z.email({
          message: "Email khong dung dinh dang",
        }),
      )
      .optional(),

    password: z
      .string()
      .min(1, {
        message: "Mat khau khong duoc de trong",
      })
      .optional(),
    phone: z.string().optional(),
  }),
});
