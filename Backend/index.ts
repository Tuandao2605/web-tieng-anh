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
    };
    token?: string;
  }
}

declare module "http" {
  interface IncomingMessage {
    user?: {
      id: string;
      name: string | null;
      email: string;
    };
  }
}
