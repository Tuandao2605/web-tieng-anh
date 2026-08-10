import { Request } from "express";
import { prisma } from "../libs/prisma";
import { LoginData, RegisterData } from "../types/auth";
import { hashPassword, verifyPassword } from "../utils/hash";

export const authService = {
  register: async (data: RegisterData) => {
    return await prisma.user.create({
      data: {
        ...data,
        password: hashPassword(data.password),
      },
    });
  },
  existingEmail: async (email: string) => {
    return await prisma.user.count({
      where: {
        email,
      },
    });
  },
  login: async ({ email, password }: LoginData, req: Request) => {
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });
    if (!user) return false;
    const hash = user.password;
    if (!verifyPassword(password, hash as string)) {
      return false;
    }
    req.session.user = user;
    return true;
  },
  profile: async (id: string) => {
    const user = await prisma.user.findUnique({
      where: {
        id,
      },
    });
    return user;
  },
};
