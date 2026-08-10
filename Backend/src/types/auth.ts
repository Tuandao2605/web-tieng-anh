export type RegisterData = {
  name: string;
  email: string;
  password: string;
};

export type LoginData = {
  email: string;
  password: string;
};

export type JwtPayLoad = {
  id: string;
  email: string;
};
