import { Request } from "express";
import { prisma } from "../libs/prisma";
import { LoginData, RegisterData } from "../types/auth";
import { hashPassword, verifyPassword } from "../utils/hash";

export const authService = {
  register: async (data: RegisterData) => {
    const password = await hashPassword(data.password);
    return await prisma.user.create({
      data: {
        ...data,
        password,
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
    if (!(await verifyPassword(password, hash as string))) {
      return false;
    }
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
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
