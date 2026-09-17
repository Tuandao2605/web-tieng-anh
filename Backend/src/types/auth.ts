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
  name: string | null;
  status: boolean;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  status: boolean;
};

export type VerifiedAccessToken = {
  user: AuthenticatedUser;
  jti: string;
  expiresAt: number;
};

export type RequestAuthContext = {
  token: string | null;
  principal: VerifiedAccessToken | null;
  blacklistChecked: boolean;
  revoked: boolean;
};
