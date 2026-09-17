import type { RequestAuthContext } from "./src/types/auth";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      name: string | null;
      email: string;
    };
    csrfToken?: string;
  }
}

declare module "express" {
  interface Request {
    user?: {
      id: string;
      name: string | null;
      email: string;
      status?: boolean;
    };
    token?: string;
    authContext?: RequestAuthContext;
  }
}

declare module "http" {
  interface IncomingMessage {
    user?: {
      id: string;
      name: string | null;
      email: string;
      status?: boolean;
    };
  }
}
