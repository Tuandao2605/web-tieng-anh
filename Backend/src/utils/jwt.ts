import jwt from "jsonwebtoken";
import { JwtPayLoad } from "../types/auth";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE;
export const generateToken = (data: JwtPayLoad) => {
  return jwt.sign(
    {
      jti: crypto.randomUUID(),
      ...data,
    },
    JWT_SECRET as string,
    {
      expiresIn: JWT_EXPIRE as unknown as number,
    },
  );
};

export const verifyToken = (token: string) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string);
    return decoded;
  } catch {
    return false;
  }
};

export const decodeToken = (token: string) => {
  return jwt.decode(token);
};

export const generateRefreshToken = (data: JwtPayLoad) => {
  return jwt.sign(
    {
      jti: crypto.randomUUID(),
      ...data,
    },
    JWT_REFRESH_SECRET as string,
    {
      expiresIn: JWT_REFRESH_EXPIRE as unknown as number,
    },
  );
};

export const verifyRefreshToken = (token: string) => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET as string);
    return decoded;
  } catch {
    return false;
  }
};
