import * as bcrypt from "bcrypt";
export const hashPassword = (password: string) => {
  const salt = 10;
  return bcrypt.hashSync(password, salt);
};

export const verifyPassword = (password: string, hash: string) => {
  return bcrypt.compareSync(password, hash);
};
